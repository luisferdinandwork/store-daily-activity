// lib/oss.ts
//
// Single, centralized entry point for all Alibaba Cloud OSS (Object Storage
// Service) interaction — every upload route and the task-image cleanup cron
// goes through this file instead of touching the OSS SDK or the filesystem
// directly. All objects live under the `${OSS_FOLDER}/` prefix (default
// "storedailytask") in one bucket, and the bucket is public-read, so the URL
// returned by uploadToOss() can be used directly as an <img src>.
//
// Required env vars (see .env.local): OSS_REGION, OSS_ACCESS_KEY_ID,
// OSS_ACCESS_KEY_SECRET, OSS_BUCKET. Optional: OSS_FOLDER (default
// "storedailytask").

import OSS from 'ali-oss';

const REQUIRED_ENV_VARS = ['OSS_REGION', 'OSS_ACCESS_KEY_ID', 'OSS_ACCESS_KEY_SECRET', 'OSS_BUCKET'] as const;

let client: OSS | null = null;

function getClient(): OSS {
  if (client) return client;

  for (const key of REQUIRED_ENV_VARS) {
    if (!process.env[key]) {
      throw new Error(`Missing required env var for OSS storage: ${key}`);
    }
  }

  client = new OSS({
    region: process.env.OSS_REGION!,
    accessKeyId: process.env.OSS_ACCESS_KEY_ID!,
    accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET!,
    bucket: process.env.OSS_BUCKET!,
    secure: true,
  });

  return client;
}

function rootFolder(): string {
  const folder = process.env.OSS_FOLDER || 'storedailytask';
  return folder.replace(/^\/+|\/+$/g, ''); // trim leading/trailing slashes
}

function toObjectKey(key: string): string {
  return `${rootFolder()}/${key}`.replace(/\/+/g, '/');
}

/**
 * Uploads a buffer to OSS under `${OSS_FOLDER}/<key>` and returns its public URL.
 */
export async function uploadToOss(buffer: Buffer, key: string, contentType?: string): Promise<string> {
  const objectKey = toObjectKey(key);
  const result = await getClient().put(objectKey, buffer, {
    mime: contentType,
  });
  return result.url;
}

/**
 * Returns true if an object already exists at `${OSS_FOLDER}/<key>` — used to
 * replicate the upload routes' local filename-collision-avoidance against OSS.
 */
export async function ossObjectExists(key: string): Promise<boolean> {
  try {
    await getClient().head(toObjectKey(key));
    return true;
  } catch (err) {
    if (err instanceof Error && (err as { status?: number }).status === 404) {
      return false;
    }
    throw err;
  }
}

function urlToObjectKey(url: string): string | null {
  try {
    const bucket = process.env.OSS_BUCKET;
    const region = process.env.OSS_REGION;
    if (!bucket || !region) return null;

    const parsed = new URL(url);
    const expectedHost = `${bucket}.${region}.aliyuncs.com`;
    if (parsed.hostname !== expectedHost) return null;

    const key = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
    return key || null;
  } catch {
    return null;
  }
}

/**
 * True if the given URL points at an object in our OSS bucket (as opposed to
 * a legacy local `/uploads/...` path or some other host).
 */
export function isOssUrl(url: string): boolean {
  return urlToObjectKey(url) !== null;
}

/**
 * Deletes one or more objects from OSS, given their public URLs. Silently
 * ignores URLs that don't resolve to an object in our bucket.
 */
export async function deleteFromOss(urls: string | string[]): Promise<void> {
  const list = Array.isArray(urls) ? urls : [urls];
  const keys = list.map(urlToObjectKey).filter((k): k is string => k !== null);
  if (!keys.length) return;

  await getClient().deleteMulti(keys, { quiet: true });
}
