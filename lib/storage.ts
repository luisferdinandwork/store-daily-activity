// lib/storage.ts
//
// Single, centralized entry point for all image / file object storage. Every
// upload route and the task-image cleanup cron goes through this file instead
// of touching an S3 SDK directly.
//
// Backend: Biznet NOS (Neo Object Storage), an S3-compatible service. The
// bucket is replicated across two regions and both endpoints front the SAME
// bucket and the SAME data:
//
//   primary   — Jawa Barat (WJV)  https://nos.wjv-1.neo.id
//   secondary — Jakarta   (JKT)   https://nos.jkt-1.neo.id
//
// We treat them as a hot/hot pair: every request tries the last-known-good
// endpoint first and transparently retries the other one on a network or 5xx
// failure, then "sticks" to whichever endpoint answered. Objects live under
// the `${NOS_FOLDER}/` prefix (default "storedailytask") and are uploaded
// public-read, so the URL returned by uploadToStorage() works directly as an
// <img src>.
//
// Required env (.env.local):
//   NOS_ACCESS_KEY_ID, NOS_SECRET_ACCESS_KEY, NOS_BUCKET
// Optional env:
//   NOS_ENDPOINT_PRIMARY    (default https://nos.wjv-1.neo.id)
//   NOS_ENDPOINT_SECONDARY  (default https://nos.jkt-1.neo.id)
//   NOS_REGION              (default "id-jkt-1" — NOS ignores it, the SDK needs a value)
//   NOS_FOLDER              (default "storedailytask")
//   NOS_PUBLIC_BASE_URL     (override the base used when building public URLs,
//                            e.g. a CDN in front of the bucket)

import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';

const DEFAULT_PRIMARY = 'https://nos.wjv-1.neo.id';
const DEFAULT_SECONDARY = 'https://nos.jkt-1.neo.id';

interface Endpoint {
  host: string;
  url: string;
  client: S3Client;
}

let endpoints: Endpoint[] | null = null;
let preferred = 0; // index of the endpoint that answered most recently

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var for object storage: ${key}`);
  return val;
}

function bucket(): string {
  return requireEnv('NOS_BUCKET');
}

function endpointUrls(): string[] {
  return [
    process.env.NOS_ENDPOINT_PRIMARY || DEFAULT_PRIMARY,
    process.env.NOS_ENDPOINT_SECONDARY || DEFAULT_SECONDARY,
  ]
    .map((u) => u.replace(/\/+$/, ''))
    .filter((u, i, all) => u && all.indexOf(u) === i);
}

function getEndpoints(): Endpoint[] {
  if (endpoints) return endpoints;

  const accessKeyId = requireEnv('NOS_ACCESS_KEY_ID');
  const secretAccessKey = requireEnv('NOS_SECRET_ACCESS_KEY');
  const region = process.env.NOS_REGION || 'id-jkt-1';

  endpoints = endpointUrls().map((url) => ({
    host: new URL(url).host,
    url,
    client: new S3Client({
      region,
      endpoint: url,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true, // URLs look like https://<endpoint>/<bucket>/<key>
    }),
  }));

  return endpoints;
}

/** Retry on the other endpoint only for failures that didn't reach the server
 *  or that the server itself couldn't handle (never on 4xx like 403/404). */
function isRetryable(err: unknown): boolean {
  const e = err as {
    name?: string;
    code?: string;
    $metadata?: { httpStatusCode?: number };
  };
  const status = e?.$metadata?.httpStatusCode;
  if (status && (status >= 500 || status === 429)) return true;
  const netCodes = ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN', 'EPIPE'];
  if (e?.code && netCodes.includes(e.code)) return true;
  if (e?.name && ['TimeoutError', 'AbortError', 'NetworkingError'].includes(e.name)) return true;
  return false;
}

async function withFailover<T>(op: (client: S3Client) => Promise<T>): Promise<T> {
  const eps = getEndpoints();
  const order = [preferred, ...eps.map((_, i) => i).filter((i) => i !== preferred)];

  let lastErr: unknown;
  for (const idx of order) {
    try {
      const result = await op(eps[idx].client);
      preferred = idx; // stick to whatever just worked
      return result;
    } catch (err) {
      lastErr = err;
      if (eps.length === 1 || idx === order[order.length - 1] || !isRetryable(err)) throw err;
      console.warn(
        `[storage] endpoint ${eps[idx].host} failed (${
          err instanceof Error ? err.message : String(err)
        }); falling over to the next endpoint`,
      );
    }
  }
  throw lastErr;
}

function rootFolder(): string {
  return (process.env.NOS_FOLDER || 'storedailytask').replace(/^\/+|\/+$/g, '');
}

function toObjectKey(key: string): string {
  return `${rootFolder()}/${key}`.replace(/\/+/g, '/').replace(/^\//, '');
}

function publicBaseUrl(): string {
  const override = process.env.NOS_PUBLIC_BASE_URL;
  const base = override ? override : `${endpointUrls()[0]}/${bucket()}`;
  return base.replace(/\/+$/, '');
}

function encodeKey(objectKey: string): string {
  return objectKey.split('/').map(encodeURIComponent).join('/');
}

/**
 * Uploads a buffer under `${NOS_FOLDER}/<key>` and returns its public URL.
 */
export async function uploadToStorage(
  buffer: Buffer,
  key: string,
  contentType?: string,
): Promise<string> {
  const objectKey = toObjectKey(key);
  await withFailover((client) =>
    client.send(
      new PutObjectCommand({
        Bucket: bucket(),
        Key: objectKey,
        Body: buffer,
        ContentType: contentType,
        ACL: 'public-read',
      }),
    ),
  );
  return `${publicBaseUrl()}/${encodeKey(objectKey)}`;
}

/**
 * Returns true if an object already exists at `${NOS_FOLDER}/<key>` — used by
 * the upload routes to avoid filename collisions.
 */
export async function storageObjectExists(key: string): Promise<boolean> {
  try {
    await withFailover((client) =>
      client.send(new HeadObjectCommand({ Bucket: bucket(), Key: toObjectKey(key) })),
    );
    return true;
  } catch (err) {
    const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
    const name = (err as { name?: string })?.name;
    if (status === 404 || name === 'NotFound' || name === 'NoSuchKey') return false;
    throw err;
  }
}

/** Reverses uploadToStorage(): a public URL back to its object key, or null if
 *  the URL isn't one of ours. Accepts either endpoint's host and both
 *  path-style and virtual-hosted URL shapes, plus an optional CDN base. */
function urlToObjectKey(url: string): string | null {
  try {
    const parsed = new URL(url);
    const b = bucket();
    const endpointHosts = getEndpoints().map((e) => e.host);

    // Optional CDN base — objects sit at its root with no bucket segment.
    if (process.env.NOS_PUBLIC_BASE_URL) {
      const cdn = new URL(process.env.NOS_PUBLIC_BASE_URL);
      const prefix = cdn.pathname.replace(/\/+$/, '');
      if (parsed.hostname === cdn.host && parsed.pathname.startsWith(`${prefix}/`)) {
        return decodeURIComponent(parsed.pathname.slice(prefix.length + 1)) || null;
      }
    }

    // path-style: https://<endpoint-host>/<bucket>/<key>
    if (endpointHosts.includes(parsed.hostname)) {
      const path = parsed.pathname.replace(/^\/+/, '');
      return path.startsWith(`${b}/`) ? decodeURIComponent(path.slice(b.length + 1)) || null : null;
    }
    // virtual-hosted style: https://<bucket>.<endpoint-host>/<key>
    for (const h of endpointHosts) {
      if (parsed.hostname === `${b}.${h}`) {
        return decodeURIComponent(parsed.pathname.replace(/^\/+/, '')) || null;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * True if the given URL points at an object we manage (as opposed to a legacy
 * `/uploads/...` path, a legacy Aliyun OSS URL, or some other host).
 */
export function isStorageUrl(url: string): boolean {
  return urlToObjectKey(url) !== null;
}

/**
 * Deletes one or more objects, given their public URLs. Silently ignores URLs
 * that don't resolve to an object in our bucket.
 */
export async function deleteFromStorage(urls: string | string[]): Promise<void> {
  const list = Array.isArray(urls) ? urls : [urls];
  const keys = list
    .map(urlToObjectKey)
    .filter((k): k is string => k !== null)
    .map((k) => ({ Key: k }));
  if (!keys.length) return;

  // S3 DeleteObjects caps at 1000 keys per call.
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000);
    await withFailover((client) =>
      client.send(
        new DeleteObjectsCommand({
          Bucket: bucket(),
          Delete: { Objects: batch, Quiet: true },
        }),
      ),
    );
  }
}
