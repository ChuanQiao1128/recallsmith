// mobile/src/content/contentConfig.ts
// Step 2: 内容源配置（先写死，后面可换 CloudFront）

export const CONTENT_BASE_URL =
  'https://devcards-content-dev.s3.ap-southeast-2.amazonaws.com/'; // ✅ 改成你的 bucket

export const MANIFEST_URL = `${CONTENT_BASE_URL}manifest/index.json`;