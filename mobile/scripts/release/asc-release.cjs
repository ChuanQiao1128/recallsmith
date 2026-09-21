#!/usr/bin/env node
// asc-release.cjs — App Store Connect steps that `eas submit` does not do, with the LOCAL Apple
// session (the one `eas credentials --platform ios` refreshes into ~/.app-store/auth): wait for the
// uploaded build to finish processing, ensure the App Store version exists, set What's New, attach
// the build, set release-after-approval and, with --submit, create and submit the review submission.
//
// Uses @expo/apple-utils from the global eas-cli install (same library, same cookie). Reads no
// secret and prints none. Default is a plan (read-only); --apply mutates; --submit also submits.
//
//   node asc-release.cjs --version 1.6.0 --build 16 [--wait-build] [--whats-new FILE]
//                        [--description FILE] [--keywords FILE] [--promo FILE] [--subtitle FILE]
//                        [--release-type AFTER_APPROVAL|MANUAL] [--apply] [--submit]
//   description/keywords/promo live on the version's en-US localization; subtitle lives on the
//   App Info localization (Apple limits: subtitle 30, promo 170, keywords 100, description 4000).
//                        [--bundle-id com.timeawake.recallsmith] [--username info@timeawake.co.nz]
//
// Exit codes: 0 ok · 1 error · 3 Apple session expired (re-run `eas credentials --platform ios`).
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

function argv() {
  const a = process.argv.slice(2), o = { apply: false, submit: false, waitBuild: false, releaseType: 'AFTER_APPROVAL', bundleId: 'com.timeawake.recallsmith', username: 'info@timeawake.co.nz' };
  for (let i = 0; i < a.length; i++) {
    const k = a[i], v = a[i + 1];
    if (k === '--apply') o.apply = true;
    else if (k === '--submit') { o.submit = true; o.apply = true; }
    else if (k === '--wait-build') o.waitBuild = true;
    else if (k === '--version') o.version = a[++i];
    else if (k === '--build') o.build = a[++i];
    else if (k === '--whats-new') o.whatsNew = a[++i];
    else if (k === '--description') o.description = a[++i];
    else if (k === '--keywords') o.keywords = a[++i];
    else if (k === '--promo') o.promo = a[++i];
    else if (k === '--subtitle') o.subtitle = a[++i];
    else if (k === '--release-type') o.releaseType = a[++i];
    else if (k === '--bundle-id') o.bundleId = a[++i];
    else if (k === '--username') o.username = a[++i];
    else throw new Error('unknown arg ' + k + (v ? ' ' + v : ''));
  }
  if (!o.version || !o.build) throw new Error('--version and --build are required');
  return o;
}

function appleUtils() {
  const root = execSync('npm root -g', { encoding: 'utf8' }).trim();
  const p = path.join(root, 'eas-cli', 'node_modules', '@expo', 'apple-utils');
  if (!fs.existsSync(p)) throw new Error('@expo/apple-utils not found under global eas-cli at ' + p);
  return require(p);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const o = argv();
  const { Auth, App, Build, ReviewSubmission } = appleUtils();
  Auth.resetInMemoryData();
  const session = await Auth.tryRestoringAuthStateFromUserCredentialsAsync({ username: o.username }, {});
  if (!session) { console.error('Apple session expired for ' + o.username + ' — run: eas credentials --platform ios'); process.exit(3); }
  const ctx = session.context;
  const apps = await App.getAsync(ctx, { query: { filter: { bundleId: o.bundleId } } });
  const app = Array.isArray(apps) ? apps[0] : apps;
  if (!app) throw new Error('app not found for ' + o.bundleId);
  console.log('APP', app.id, o.bundleId, 'team', ctx.teamId);

  // 1. the build (must be processed = VALID, not expired)
  // /apps/{id}/builds refuses filters; the top-level /builds endpoint takes filter[app] + the rest.
  const findBuild = async () => {
    const builds = await Build.getAsync(ctx, { query: { filter: { app: app.id, version: o.build, 'preReleaseVersion.version': o.version }, sort: '-uploadedDate', limit: 10 } });
    return builds.find((b) => b.attributes.processingState === 'VALID' && !b.attributes.expired) || builds[0] || null;
  };
  let build = await findBuild();
  if (o.waitBuild) {
    const deadline = Date.now() + 60 * 60 * 1000;
    while (!(build && build.attributes.processingState === 'VALID') && Date.now() < deadline) {
      console.log('BUILD', build ? build.attributes.processingState : 'not uploaded yet', '- waiting 60s');
      await sleep(60000); build = await findBuild();
    }
  }
  if (!build) throw new Error('no build ' + o.version + ' (' + o.build + ') on App Store Connect');
  console.log('BUILD', build.id, o.version + ' (' + o.build + ')', build.attributes.processingState, build.attributes.uploadedDate);
  if (build.attributes.processingState !== 'VALID') throw new Error('build not processed: ' + build.attributes.processingState);

  // 2. the editable App Store version
  let version = await app.getEditAppStoreVersionAsync({ platform: 'IOS' });
  console.log('VERSION(edit)', version ? version.attributes.versionString + ' ' + (version.attributes.appVersionState || version.attributes.appStoreState) : 'none');
  const whatsNew = o.whatsNew ? fs.readFileSync(o.whatsNew, 'utf8').trim() : null;
  const readOpt = (f, max, name) => { if (!f) return null; const t = fs.readFileSync(f, 'utf8').trim(); if (t.length > max) throw new Error(name + ' is ' + t.length + ' chars (max ' + max + ')'); return t; };
  const description = readOpt(o.description, 4000, 'description');
  const keywords = readOpt(o.keywords, 100, 'keywords');
  const promo = readOpt(o.promo, 170, 'promotionalText');
  const subtitle = readOpt(o.subtitle, 30, 'subtitle');
  const plan = [];
  if (!version) plan.push('create version ' + o.version);
  else if (version.attributes.versionString !== o.version) plan.push('rename edit version ' + version.attributes.versionString + ' -> ' + o.version);
  if (whatsNew) plan.push('set en-US What\'s New (' + whatsNew.length + ' chars)');
  if (description) plan.push('set en-US description (' + description.length + ' chars)');
  if (keywords) plan.push('set en-US keywords (' + keywords.length + ' chars)');
  if (promo) plan.push('set en-US promotional text (' + promo.length + ' chars)');
  if (subtitle) plan.push('set en-US subtitle (' + subtitle.length + ' chars)');
  plan.push('attach build ' + build.id);
  plan.push('releaseType=' + o.releaseType);
  if (o.submit) plan.push('create review submission + submit for review');
  console.log('PLAN', o.apply ? '(applying)' : '(dry run — add --apply)'); for (const p of plan) console.log('  -', p);
  if (!o.apply) return;

  if (!version) version = await app.createVersionAsync({ versionString: o.version, platform: 'IOS' });
  else if (version.attributes.versionString !== o.version) version = await version.updateAsync({ versionString: o.version });
  if (whatsNew || description || keywords || promo) {
    const locs = await version.getLocalizationsAsync();
    let loc = locs.find((l) => l.attributes.locale === 'en-US') || locs[0];
    if (!loc) loc = await version.createLocalizationAsync({ locale: 'en-US' });
    const patch = {};
    if (whatsNew) patch.whatsNew = whatsNew;
    if (description) patch.description = description;
    if (keywords) patch.keywords = keywords;
    if (promo) patch.promotionalText = promo;
    await loc.updateAsync(patch);
    console.log('LOCALIZATION set on', loc.attributes.locale, Object.keys(patch).join(','));
  }
  if (subtitle) {
    // apple-utils: app.getEditAppInfoAsync() = the App Info in an editable state (falls back to the first one).
    const info = (await app.getEditAppInfoAsync()) || (await app.getAppInfoAsync())[0];
    if (!info) throw new Error('no App Info record to put the subtitle on');
    const ilocs = await info.getLocalizationsAsync();
    let iloc = ilocs.find((l) => l.attributes.locale === 'en-US') || ilocs[0];
    if (!iloc) iloc = await info.createLocalizationAsync({ locale: 'en-US' });
    await iloc.updateAsync({ subtitle });
    console.log('SUBTITLE set on', iloc.attributes.locale);
  }
  await version.updateBuildAsync({ buildId: build.id });
  version = await version.updateAsync({ releaseType: o.releaseType });
  console.log('VERSION', version.id, version.attributes.versionString, 'releaseType', version.attributes.releaseType, 'state', version.attributes.appVersionState || version.attributes.appStoreState);
  if (!o.submit) return;

  let rs = await app.getInProgressReviewSubmissionAsync({ platform: 'IOS' });
  if (!rs) rs = await app.createReviewSubmissionAsync({ platform: 'IOS' });
  const items = await rs.getReviewSubmissionItemsAsync();
  if (!items.some((it) => (it.attributes && it.attributes.appStoreVersion && it.attributes.appStoreVersion.id === version.id) || JSON.stringify(it).includes(version.id))) {
    await rs.addAppStoreVersionToReviewItems(version.id);
  }
  const submitted = await rs.submitForReviewAsync();
  const state = (submitted && submitted.attributes && submitted.attributes.state) || 'submitted';
  console.log('REVIEW_SUBMISSION', rs.id, state);
  const after = await ReviewSubmission.infoAsync(ctx, { id: rs.id }).catch(() => null);
  if (after) console.log('REVIEW_SUBMISSION_STATE', after.attributes.state);
})().catch((e) => { console.error('ERROR', e && e.message ? e.message : e); process.exit(1); });
