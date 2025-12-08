#!/usr/bin/env node
import crypto from "node:crypto";
import path from "node:path";
import process from "node:process";
import { readFile, writeFile } from "node:fs/promises";

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
// 可选：发布后推送
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";

function toCamel(k) {
  return k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i];
    if (!raw.startsWith("--")) continue;

    const eq = raw.indexOf("=");
    let key = raw.slice(2);
    let val = null;

    if (eq !== -1) {
      key = raw.slice(2, eq);
      val = raw.slice(eq + 1);
    } else {
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        val = next;
        i++;
      }
    }

    const ck = toCamel(key);
    if (val === null) {
      out[ck] = true;
    } else if (val === "true") out[ck] = true;
    else if (val === "false") out[ck] = false;
    else out[ck] = val;
  }
  return out;
}

function normalizeS3Key(k) {
  return String(k || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/{2,}/g, "/");
}

function joinS3Key(prefix, key) {
  const p = normalizeS3Key(prefix || "");
  const k = normalizeS3Key(key || "");
  if (!p) return k;
  return `${p.replace(/\/+$/, "")}/${k}`;
}

async function sha256OfBuffer(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

async function sniffLocalRoot(manifestPath, deckPaths, explicitRoot) {
  if (explicitRoot) return path.resolve(explicitRoot);

  const candidates = [
    path.dirname(manifestPath), // e.g. content/manifest
    path.dirname(path.dirname(manifestPath)), // e.g. content
    process.cwd(),
  ];

  let best = { root: null, hit: -1 };

  for (const root of candidates) {
    let hit = 0;
    for (const pth of deckPaths) {
      const fp = path.resolve(root, pth);
      try {
        // eslint-disable-next-line no-unused-vars
        const _ = await readFile(fp);
        hit++;
      } catch {
        // ignore
      }
    }
    if (hit > best.hit) best = { root, hit };
  }

  if (!best.root || best.hit <= 0) {
    throw new Error(
      `Cannot find deck files from manifest Paths.\nTried roots: ${candidates.join(
        ", "
      )}\nTip: pass --root <dir> where "decks/..." exists.`
    );
  }

  return path.resolve(best.root);
}

function contentTypeForKey(key) {
  const k = key.toLowerCase();
  if (k.endsWith(".json")) return "application/json; charset=utf-8";
  if (k.endsWith(".zip")) return "application/zip";
  return "application/octet-stream";
}

async function putObject({ s3, bucket, key, body, cacheControl, acl }) {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentTypeForKey(key),
      CacheControl: cacheControl || undefined,
      ACL: acl || undefined, // 可选：public-read（如果你桶策略不公开）
    })
  );
}

function makeSnsMessage({ title, body, data }) {
  const payload = {
    aps: {
      alert: { title, body },
      sound: "default",
    },
    ...data,
  };

  // SNS 要求 MessageStructure:'json'，并提供 APNS / APNS_SANDBOX
  return JSON.stringify({
    default: `${title}: ${body}`,
    APNS: JSON.stringify(payload),
    APNS_SANDBOX: JSON.stringify(payload),
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const bucket = args.bucket || process.env.S3_BUCKET;
  const region =
    args.region || process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;

  const manifestPath = args.manifest || "manifest/index.json";
  const manifestKey = args.manifestKey || "manifest/index.json";
  const prefix = args.prefix || "";

  const dryRun = Boolean(args.dryRun);
  const writeLocal = Boolean(args.writeLocal);

  // 缓存策略：manifest建议短/不缓存，deck 若你不做版本化路径，也建议 no-cache（避免 CloudFront/Safari 缓住旧文件）
  const cacheManifest =
    args.cacheManifest || "no-cache, max-age=0, must-revalidate";
  const cacheDeck = args.cacheDeck || "no-cache, max-age=0, must-revalidate";

  // 可选：如果你需要对象 ACL（通常不推荐，建议用桶策略/CloudFront OAC）
  const acl = args.acl || undefined; // e.g. public-read

  // 可选：发布后推送
  const notify = Boolean(args.notify);
  const snsTopicArn = args.snsTopicArn || process.env.SNS_TOPIC_ARN;

  if (!bucket) throw new Error("Missing S3 bucket. Use --bucket or env S3_BUCKET");
  if (!region) throw new Error("Missing AWS region. Use --region or env AWS_REGION");

  const manifestRaw = await readFile(manifestPath, "utf8");
  const manifest = JSON.parse(manifestRaw);

  if (!manifest || !Array.isArray(manifest.Decks)) {
    throw new Error(`Invalid manifest format: expected { Decks: [...] } in ${manifestPath}`);
  }

  const deckPaths = manifest.Decks.map((d) => d?.Path).filter(Boolean);
  const localRoot = await sniffLocalRoot(manifestPath, deckPaths, args.root);

  const publishedAt = new Date().toISOString();
  manifest.PublishedAt = publishedAt;

  // 计算每个 deck 的 sha256，并把字段写回 manifest
  const uploadPlan = [];
  for (const deck of manifest.Decks) {
    if (!deck?.Path || !deck?.Slug) continue;

    const localFile = path.resolve(localRoot, deck.Path);
    const buf = await readFile(localFile);
    const sha = await sha256OfBuffer(buf);

    deck.Sha256 = sha;
    deck.SizeBytes = buf.byteLength;

    uploadPlan.push({
      type: "deck",
      slug: deck.Slug,
      localFile,
      s3Key: joinS3Key(prefix, deck.Path),
      size: buf.byteLength,
      sha256: sha,
      body: buf,
    });
  }

  const s3 = new S3Client({ region });

  console.log(`\n[Publish] bucket=${bucket} region=${region}`);
  console.log(`[Publish] manifestPath=${manifestPath}`);
  console.log(`[Publish] localRoot=${localRoot}`);
  console.log(`[Publish] dryRun=${dryRun} writeLocal=${writeLocal}`);
  console.log("");

  // 1) 上传 deck 文件
  for (const item of uploadPlan) {
    console.log(
      `- deck ${item.slug} -> s3://${bucket}/${item.s3Key} (${item.size} bytes, sha256=${item.sha256.slice(
        0,
        12
      )}...)`
    );
    if (!dryRun) {
      await putObject({
        s3,
        bucket,
        key: item.s3Key,
        body: item.body,
        cacheControl: cacheDeck,
        acl,
      });
    }
  }

  // 2) 上传 manifest
  const manifestS3Key = joinS3Key(prefix, manifestKey);
  const manifestBody = Buffer.from(JSON.stringify(manifest, null, 2) + "\n", "utf8");

  console.log(`\n- manifest -> s3://${bucket}/${manifestS3Key} (${manifestBody.byteLength} bytes)`);
  if (!dryRun) {
    await putObject({
      s3,
      bucket,
      key: manifestS3Key,
      body: manifestBody,
      cacheControl: cacheManifest,
      acl,
    });
  }

  // 3) 可选：回写本地 manifest
  if (writeLocal && !dryRun) {
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
    console.log(`\n[OK] Wrote local manifest: ${manifestPath}`);
  }

  // 4) 可选：发布后推送
  if (notify) {
    if (!snsTopicArn) {
      console.log("\n[Skip Notify] missing SNS_TOPIC_ARN (or --sns-topic-arn).");
    } else if (dryRun) {
      console.log(`\n[DryRun Notify] would publish to ${snsTopicArn}`);
    } else {
      const sns = new SNSClient({ region });

      const msg = makeSnsMessage({
        title: "DevCards",
        body: "New deck updates are available. Tap to refresh.",
        data: {
          type: "deck_update",
          publishedAt,
          manifestKey: manifestKey, // app 可用来定位 manifest（可选）
        },
      });

      await sns.send(
        new PublishCommand({
          TopicArn: snsTopicArn,
          MessageStructure: "json",
          Message: msg,
        })
      );

      console.log(`\n[OK] Notified via SNS topic: ${snsTopicArn}`);
    }
  }

  console.log("\n[Done]");
}

main().catch((err) => {
  console.error("\n[Error]", err?.message || err);
  process.exit(1);
});