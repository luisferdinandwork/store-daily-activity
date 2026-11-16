// lib/bc/bin-check-audit.ts
// ─────────────────────────────────────────────────────────────────────────────
// Server-side only: the Business Central reads behind the Audit pages "Hasil Cek Bin" and "Stock Opname". Same BC
// company API + credentials as the staff Cek Bin (lib/bc/bin-content-check.ts → resolveBinCheckConfig:
// BC_API_BIN_BASE_URL / BC_API_BIN_USERNAME / BC_API_BIN_PASSWORD).
//
//   getBinCheckRangeHeaders   ppBinContentCheckHeaders + lines for a whole PERIOD in one query (optionally a few
//                             locations) — only the fields the report needs ($select, also inside the $expand).
//   getBinCheckDayHeaders     the same feed for ONE store + day, every field — so a price BC adds to the lines
//                             later reaches the Stock Opname without a code change (see SO_PRICE_FIELDS).
//   getStoreBinContents       ppQueryBinContents of a location NOW: how many bins hold stock + the quantity in them.
//
// Never throws: a missing login / timeout / bad answer comes back as state `not_configured` / `unavailable`, so BC can
// never break an Audit page. Successful answers are cached briefly (a period that includes today shorter); failures
// are not cached.
// ─────────────────────────────────────────────────────────────────────────────

import { fetchAllBusinessCentralRows } from '@/lib/bc/client';
import { resolveBinCheckConfig } from '@/lib/bc/bin-content-check';
import { addDaysKey, isDayKey, jakartaTodayKey } from '@/lib/day-bucket';

export type BcFeedState = 'ok' | 'not_configured' | 'unavailable';

const HEADERS_ENTITY = 'ppBinContentCheckHeaders';
const BIN_CONTENTS_ENTITY = 'ppQueryBinContents';
const SCHEMA_VERSION = '2.0';
/** A period of every store is a big answer; give it time, but never hang a page. */
const RANGE_TIMEOUT_MS = 45_000;
const DAY_TIMEOUT_MS = 20_000;

const query = (options: Array<[string, string]>) => options.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
const quote = (v: string) => `'${v.replace(/'/g, "''")}'`;

// ─── Logging + cache ─────────────────────────────────────────────────────────

const LOG_EVERY_MS = 10 * 60_000;
const lastLogged = new Map<string, number>();
function logThrottled(key: string, message: string, detail?: unknown) {
  const now = Date.now();
  if (now - (lastLogged.get(key) ?? 0) < LOG_EVERY_MS) return;
  lastLogged.set(key, now);
  console.error(message, detail instanceof Error ? detail.message : detail ?? '');
}

const cache = new Map<string, { at: number; ttl: number; value: Promise<unknown> }>();

/** Runs `load` once per key while fresh; a failed or not-ok result is dropped so the next caller retries. */
async function cached<T extends { state: BcFeedState }>(key: string, ttl: number, load: () => Promise<T>, force = false): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl && !(force && Date.now() - hit.at > 10_000)) return hit.value as Promise<T>;
  const value = load();
  if (cache.size > 200) cache.clear();
  cache.set(key, { at: Date.now(), ttl, value });
  void value.then(
    (r) => {
      if (r.state !== 'ok' && cache.get(key)?.value === value) cache.delete(key);
    },
    () => {
      if (cache.get(key)?.value === value) cache.delete(key);
    },
  );
  return value;
}

const ttlFor = (lastDay: string) => (lastDay >= jakartaTodayKey() ? 60_000 : 10 * 60_000);

// ─── Period (Hasil Cek Bin) ──────────────────────────────────────────────────

export interface BinCheckRangeResult {
  state: BcFeedState;
  headers: unknown[];
  fetchedAt: string | null;
}

export function binCheckRangeUrl(baseUrl: string, from: string, to: string, locations?: readonly string[]): string {
  const filter = [`date ge ${from}`, `date lt ${addDaysKey(to, 1)}`];
  if (locations?.length === 1) filter.unshift(`location eq ${quote(locations[0])}`);
  else if (locations && locations.length > 1) filter.unshift(`location in (${locations.map(quote).join(',')})`);
  return `${baseUrl}${HEADERS_ENTITY}?${query([
    ['$select', 'location,date,binCode,checked'],
    ['$expand', 'ppBinContentCheckLines($select=binCode,scanQuantity,binQuantity,binContentCheckStatus)'],
    ['$schemaversion', SCHEMA_VERSION],
    ['$filter', filter.join(' and ')],
  ])}`;
}

/** Every Cek Bin header (+ its lines) between `from` and `to` (Jakarta days, inclusive). */
export async function getBinCheckRangeHeaders(params: {
  from: string;
  to: string;
  /** Store codes; empty/undefined = every location. */
  locations?: readonly string[];
  force?: boolean;
}): Promise<BinCheckRangeResult> {
  const { from, to } = params;
  const locations = [...new Set((params.locations ?? []).map((l) => l.trim().toUpperCase()).filter(Boolean))].sort();
  const config = resolveBinCheckConfig();
  if (!config) return { state: 'not_configured', headers: [], fetchedAt: null };
  if (!isDayKey(from) || !isDayKey(to)) return { state: 'unavailable', headers: [], fetchedAt: null };

  return cached(
    `range|${from}|${to}|${locations.join(',')}`,
    ttlFor(to),
    async () => {
      try {
        const headers = await fetchAllBusinessCentralRows(binCheckRangeUrl(config.baseUrl, from, to, locations), config.settings, {
          timeoutMs: RANGE_TIMEOUT_MS,
        });
        return { state: 'ok' as const, headers, fetchedAt: new Date().toISOString() };
      } catch (err) {
        logThrottled('range', `[bin-check-audit] ${HEADERS_ENTITY} ${from}..${to} failed:`, err);
        return { state: 'unavailable' as const, headers: [], fetchedAt: null };
      }
    },
    params.force,
  );
}

// ─── One store-day, every field (Stock Opname) ───────────────────────────────

export function binCheckDayUrl(baseUrl: string, location: string, day: string): string {
  return `${baseUrl}${HEADERS_ENTITY}?${query([
    ['$expand', 'ppBinContentCheckLines'],
    ['$schemaversion', SCHEMA_VERSION],
    ['$filter', `location eq ${quote(location)} and date ge ${day} and date lt ${addDaysKey(day, 1)}`],
  ])}`;
}

export async function getBinCheckDayHeaders(params: { location: string; day: string; force?: boolean }): Promise<BinCheckRangeResult> {
  const location = params.location.trim().toUpperCase();
  const config = resolveBinCheckConfig();
  if (!config) return { state: 'not_configured', headers: [], fetchedAt: null };
  if (!location || !isDayKey(params.day)) return { state: 'unavailable', headers: [], fetchedAt: null };

  return cached(
    `day|${location}|${params.day}`,
    params.day >= jakartaTodayKey() ? 30_000 : 10 * 60_000,
    async () => {
      try {
        const headers = await fetchAllBusinessCentralRows(binCheckDayUrl(config.baseUrl, location, params.day), config.settings, {
          timeoutMs: DAY_TIMEOUT_MS,
        });
        return { state: 'ok' as const, headers, fetchedAt: new Date().toISOString() };
      } catch (err) {
        logThrottled(`day|${location}`, `[bin-check-audit] ${HEADERS_ENTITY} ${location} ${params.day} failed:`, err);
        return { state: 'unavailable' as const, headers: [], fetchedAt: null };
      }
    },
    params.force,
  );
}

// ─── Bin contents now ────────────────────────────────────────────────────────

export interface StoreBinContents {
  state: BcFeedState;
  /** Bins that hold stock right now. */
  bins: number | null;
  /** Σ quantity in those bins (base unit). */
  quantity: number | null;
  fetchedAt: string | null;
}

export function binContentsUrl(baseUrl: string, location: string): string {
  return `${baseUrl}${BIN_CONTENTS_ENTITY}?${query([
    ['$select', 'binCode,quantity'],
    ['$schemaversion', SCHEMA_VERSION],
    ['$filter', `locationCode eq ${quote(location)} and quantity gt 0`],
  ])}`;
}

export async function getStoreBinContents(params: { location: string; force?: boolean }): Promise<StoreBinContents> {
  const location = params.location.trim().toUpperCase();
  const config = resolveBinCheckConfig();
  if (!config) return { state: 'not_configured', bins: null, quantity: null, fetchedAt: null };
  if (!location) return { state: 'unavailable', bins: null, quantity: null, fetchedAt: null };

  return cached(
    `contents|${location}`,
    5 * 60_000,
    async () => {
      try {
        const rows = await fetchAllBusinessCentralRows(binContentsUrl(config.baseUrl, location), config.settings, {
          timeoutMs: DAY_TIMEOUT_MS,
        });
        const bins = new Set<string>();
        let quantity = 0;
        for (const row of rows) {
          if (!row || typeof row !== 'object') continue;
          const r = row as { binCode?: unknown; quantity?: unknown };
          const qty = Number(r.quantity);
          if (!Number.isFinite(qty) || qty <= 0) continue;
          if (typeof r.binCode === 'string' && r.binCode.trim()) bins.add(r.binCode.trim().toUpperCase());
          quantity += qty;
        }
        return { state: 'ok' as const, bins: bins.size, quantity: Math.round(quantity), fetchedAt: new Date().toISOString() };
      } catch (err) {
        logThrottled(`contents|${location}`, `[bin-check-audit] ${BIN_CONTENTS_ENTITY} ${location} failed:`, err);
        return { state: 'unavailable' as const, bins: null, quantity: null, fetchedAt: null };
      }
    },
    params.force,
  );
}
