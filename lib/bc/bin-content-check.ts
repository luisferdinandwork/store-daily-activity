// lib/bc/bin-content-check.ts
// ─────────────────────────────────────────────────────────────────────────────
// Server-side only: reads the PP Bin Content Check results of ONE store on ONE
// Jakarta day from Business Central, for the employee Cek Bin task.
//
//   ppBinContentCheckHeaders?$expand=ppBinContentCheckLines   (qty scanned vs in bin)
//   ppBinContentChecks                                        (per-bin summary lists)
//
// Both are queried with `location eq '<stores.storeNo>' and date ge D and date lt D+1`
// (never "everything, filtered locally"), in parallel, over HTTP Basic auth with
// credentials that live only in the server environment:
//
//   BC_API_BIN_USERNAME / BC_API_BIN_PASSWORD   (required)
//   BC_API_BIN_BASE_URL                         (optional — replaces the UAT base below; the
//                                                company root OR a full entity URL pasted from
//                                                Postman, see normalizeBinCheckBaseUrl)
//
// This module NEVER throws. Missing credentials, a rejected login, a timeout, a
// bad payload … all come back as a BinCheckResult with state `not_configured` /
// `unavailable` (and a clear server log line), so the Cek Bin task page can't be
// broken by BC. The pure judging rules are in lib/bin-check.ts.
// ─────────────────────────────────────────────────────────────────────────────

import { fetchAllBusinessCentralRows } from '@/lib/bc/client';
import type { ResolvedBusinessCentralSettings } from '@/lib/performance/business-central-settings';
import { addDaysKey, isDayKey, jakartaTodayKey } from '@/lib/day-bucket';
import { buildBinCheckIssues, type BinCheckResult } from '@/lib/bin-check';

/**
 * BC company API root — UAT for now. Production will differ: set
 * BC_API_BIN_BASE_URL (the root ending in `.../companies(<guid>)/`; a full entity URL
 * is accepted too) instead of editing code.
 */
export const BC_BIN_CHECK_DEFAULT_BASE_URL =
  'https://bc.panatradeprestasi.com:7248/UAT/api/panatradeprestasi/pntpri/v1.0/companies(fdc329b5-9a4a-ed11-ac38-81e458651713)/';

const HEADERS_ENTITY = 'ppBinContentCheckHeaders';
const SUMMARY_ENTITY = 'ppBinContentChecks';
const LINES_NAVIGATION = 'ppBinContentCheckLines';
const SCHEMA_VERSION = '2.0';

/** One page of BC may take a while, but a staff phone must never wait on it forever. */
const REQUEST_TIMEOUT_MS = 12_000;

// ─── Config ──────────────────────────────────────────────────────────────────

interface BinCheckConfig {
  baseUrl: string;
  settings: ResolvedBusinessCentralSettings;
}

function clean(value: string | undefined): string {
  return value?.trim() || '';
}

/**
 * The company API root, always ending in `/`. Accepts what people actually paste into
 * `.env.local`: the root itself, or a full request URL copied from Postman
 * (`…/companies(<guid>)/ppBinContentCheckHeaders?$expand=…&$schemaversion=2.0`) — the
 * query string and a trailing entity name are dropped, because this module adds its own
 * entity, `$expand` and `$filter`. (An env loader may also have eaten the `$…` names of
 * such a pasted query; everything after the `?` is ignored, so that is harmless.)
 */
export function normalizeBinCheckBaseUrl(raw: string): string {
  let url = raw.trim().replace(/^["']+|["']+$/g, '');
  url = url.split(/[?#]/, 1)[0].replace(/\/+$/, '');
  const cut = url.lastIndexOf('/');
  const last = url.slice(cut + 1).toLowerCase();
  if (last === HEADERS_ENTITY.toLowerCase() || last === SUMMARY_ENTITY.toLowerCase()) url = url.slice(0, cut);
  return `${url}/`;
}

/** Read per call (cheap), so filling in `.env.local` + restarting is all it takes. */
export function resolveBinCheckConfig(env: NodeJS.ProcessEnv = process.env): BinCheckConfig | null {
  const username = clean(env.BC_API_BIN_USERNAME);
  const password = clean(env.BC_API_BIN_PASSWORD);
  if (!username || !password) return null;

  const baseUrl = normalizeBinCheckBaseUrl(clean(env.BC_API_BIN_BASE_URL) || BC_BIN_CHECK_DEFAULT_BASE_URL);

  return {
    baseUrl,
    settings: { apiUrl: baseUrl, authType: 'basic', username, password, source: 'env' },
  };
}

// ─── URLs ────────────────────────────────────────────────────────────────────

function escapeODataString(value: string): string {
  return value.replace(/'/g, "''");
}

/** `$` stays literal in option names; values are percent-encoded (spaces → %20, as Postman sends). */
function query(options: Array<[string, string]>): string {
  return options.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
}

/** `date` is an Edm.Date in BC, so it is compared unquoted (same as the sales feed). */
function dayFilter(location: string, day: string): string {
  return [
    `location eq '${escapeODataString(location)}'`,
    `date ge ${day}`,
    `date lt ${addDaysKey(day, 1)}`,
  ].join(' and ');
}

export function binCheckHeadersUrl(baseUrl: string, location: string, day: string): string {
  return `${baseUrl}${HEADERS_ENTITY}?${query([
    ['$expand', LINES_NAVIGATION],
    ['$schemaversion', SCHEMA_VERSION],
    ['$filter', dayFilter(location, day)],
  ])}`;
}

export function binCheckSummaryUrl(baseUrl: string, location: string, day: string): string {
  return `${baseUrl}${SUMMARY_ENTITY}?${query([
    ['$schemaversion', SCHEMA_VERSION],
    ['$filter', dayFilter(location, day)],
  ])}`;
}

// ─── Logging (clear, but not one line per page view) ─────────────────────────

const LOG_EVERY_MS = 10 * 60_000;
const lastLogged = new Map<string, number>();

function logThrottled(key: string, message: string, detail?: unknown): void {
  const now = Date.now();
  if (now - (lastLogged.get(key) ?? 0) < LOG_EVERY_MS) return;
  lastLogged.set(key, now);
  if (detail !== undefined) console.error(message, detail instanceof Error ? detail.message : detail);
  else console.error(message);
}

// ─── Fetch ───────────────────────────────────────────────────────────────────

function empty(state: BinCheckResult['state'], location: string, day: string): BinCheckResult {
  return {
    state,
    day,
    location,
    issues: [],
    checkedBins: 0,
    okItems: 0,
    quantitiesAvailable: true,
    fetchedAt: null,
  };
}

async function fetchRows(url: string, settings: ResolvedBusinessCentralSettings): Promise<unknown[]> {
  return fetchAllBusinessCentralRows(url, settings, { timeoutMs: REQUEST_TIMEOUT_MS });
}

async function loadBinCheck(location: string, day: string): Promise<BinCheckResult> {
  const config = resolveBinCheckConfig();
  if (!config) {
    logThrottled(
      'not-configured',
      '[bin-check] BC_API_BIN_USERNAME / BC_API_BIN_PASSWORD are not set — Cek Bin BC results are switched off until they are.',
    );
    return empty('not_configured', location, day);
  }

  const [headers, summary] = await Promise.allSettled([
    fetchRows(binCheckHeadersUrl(config.baseUrl, location, day), config.settings),
    fetchRows(binCheckSummaryUrl(config.baseUrl, location, day), config.settings),
  ]);

  if (headers.status === 'rejected') {
    logThrottled(`headers:${location}`, `[bin-check] ${HEADERS_ENTITY} failed for ${location} ${day}:`, headers.reason);
  }
  if (summary.status === 'rejected') {
    logThrottled(`summary:${location}`, `[bin-check] ${SUMMARY_ENTITY} failed for ${location} ${day}:`, summary.reason);
  }
  if (headers.status === 'rejected' && summary.status === 'rejected') {
    return empty('unavailable', location, day);
  }

  const built = buildBinCheckIssues({
    headers: headers.status === 'fulfilled' ? headers.value : null,
    summaries: summary.status === 'fulfilled' ? summary.value : null,
    location,
    day,
  });

  return {
    state: 'ok',
    day,
    location,
    ...built,
    fetchedAt: new Date().toISOString(),
  };
}

// ─── Cache ───────────────────────────────────────────────────────────────────
// Every employee of a store opens the same task; BC is slow. A day that is still
// running is cached briefly (scans show up within a minute), a finished day longer.
// Failures are never kept — the next caller retries.

const LIVE_TTL_MS = 45_000;
const PAST_TTL_MS = 10 * 60_000;
/** "Muat ulang" may bypass the cache, but not hammer BC. */
const FORCE_MIN_AGE_MS = 10_000;

const cache = new Map<string, { at: number; ttl: number; value: Promise<BinCheckResult> }>();

/** Test hook. */
export function clearBinCheckCache(): void {
  cache.clear();
  lastLogged.clear();
}

/**
 * The WRONG results of `location` (stores.storeNo) on Jakarta day `day`. Never
 * throws; see the header comment for the states.
 */
export async function getBinCheckResult(params: {
  location: string;
  day: string;
  /** Skip the short cache (the employee tapped "Muat ulang"). */
  force?: boolean;
}): Promise<BinCheckResult> {
  const location = params.location.trim();
  const { day } = params;

  try {
    if (!location || !isDayKey(day)) return empty('unavailable', location, day);

    // No credentials = no network and nothing worth caching.
    if (!resolveBinCheckConfig()) return await loadBinCheck(location, day);

    const key = `${location.toUpperCase()}|${day}`;
    const now = Date.now();
    const hit = cache.get(key);
    if (hit) {
      const age = now - hit.at;
      if (age < hit.ttl && (!params.force || age < FORCE_MIN_AGE_MS)) return await hit.value;
    }

    const value = loadBinCheck(location, day);
    if (cache.size > 300) cache.clear(); // hard bound; it's only a cache
    cache.set(key, { at: now, ttl: day >= jakartaTodayKey() ? LIVE_TTL_MS : PAST_TTL_MS, value });
    void value.then(
      (r) => {
        if (r.state !== 'ok' && cache.get(key)?.value === value) cache.delete(key);
      },
      () => {
        if (cache.get(key)?.value === value) cache.delete(key);
      },
    );
    return await value;
  } catch (err) {
    // Belt and braces: nothing above is supposed to throw.
    logThrottled('unexpected', `[bin-check] unexpected error for ${location} ${day}:`, err);
    return empty('unavailable', location, day);
  }
}
