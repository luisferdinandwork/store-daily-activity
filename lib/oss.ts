// lib/oss.ts
//
// LEGACY — transitional. New uploads go to Biznet NOS via `lib/storage.ts`.
// This file only recognises and deletes images that were uploaded to the old
// Alibaba Cloud OSS bucket BEFORE the switch, so the 60-day retention cleanup
// keeps working on that backlog. Once every OSS-hosted image has aged out (see
// IMAGE_RETENTION_DAYS in lib/db/utils/task-image-cleanup.ts) this file and the
// `ali-oss` dependency can be deleted.
//
// If the OSS_* env vars are unset, every function here is a harmless no-op.

import OSS from 'ali-oss';

const REQUIRED_ENV_VARS = ['OSS_REGION', 'OSS_ACCESS_KEY_ID', 'OSS_ACCESS_KEY_SECRET', 'OSS_BUCKET'] as const;

let client: OSS | null = null;

function configured(): boolean {
  return REQUIRED_ENV_VARS.every((k) => !!process.env[k]);
}

function getClient(): OSS {
  if (client) return client;
  client = new OSS({
    region: process.env.OSS_REGION!,
    accessKeyId: process.env.OSS_ACCESS_KEY_ID!,
    accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET!,
    bucket: process.env.OSS_BUCKET!,
    secure: true,
  });
  return client;
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

/** True if the URL points at an object in the legacy Alibaba OSS bucket. */
export function isLegacyOssUrl(url: string): boolean {
  return configured() && urlToObjectKey(url) !== null;
}

/**
 * Deletes legacy OSS objects given their public URLs. Ignores URLs that don't
 * resolve to the legacy bucket, and no-ops entirely if OSS_* env is unset.
 */
export async function deleteFromLegacyOss(urls: string | string[]): Promise<void> {
  if (!configured()) return;
  const list = Array.isArray(urls) ? urls : [urls];
  const keys = list.map(urlToObjectKey).filter((k): k is string => k !== null);
  if (!keys.length) return;

  await getClient().deleteMulti(keys, { quiet: true });
}
