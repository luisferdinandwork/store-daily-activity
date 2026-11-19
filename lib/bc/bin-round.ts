// lib/bc/bin-round.ts
// ─────────────────────────────────────────────────────────────────────────────
// Server-side only: the Business Central reads behind the monthly bin round (lib/bin-round.ts). Two sources:
//
//   • the BIN LIST has its own endpoint: BC_API_BIN_LIST_URL (the full `…/ppBinContentsAPI` URL; a query string
//     pasted with it is ignored). Login = BC_API_BIN_LIST_USERNAME / _PASSWORD, or else the Cek Bin login below.
//   • the SCAN RESULTS use the staff Cek Bin API (BC_API_BIN_BASE_URL / BC_API_BIN_USERNAME / BC_API_BIN_PASSWORD,
//     see lib/bc/bin-content-check.ts → resolveBinCheckConfig).
//
// Every address lives only in `.env.local` (never in code — the repo is shared).
//
//   fetchStoreBinList        ppBinContentsAPI of ONE location: every bin the store has (one row per bin × item —
//                            FF001 ≈ 15 000 rows / 318 bins), grouped to one entry per bin. Slow (10–90 s on UAT),
//                            so it is only ever called in the background and its answer is kept in the DB
//                            (store_bin_codes); never from a page a person is waiting on.
//   fetchRoundCheckHeaders   ppBinContentCheckHeaders + lines for a period (the month so far), one query for a few
//                            locations or all of them, with the item fields the wrong-line snapshot needs.
//
// Neither throws: a missing login / timeout / bad answer comes back as `state`.
// ─────────────────────────────────────────────────────────────────────────────

import { fetchAllBusinessCentralRows } from '@/lib/bc/client';
import { resolveBinCheckConfig } from '@/lib/bc/bin-content-check';
import type { ResolvedBusinessCentralSettings } from '@/lib/performance/business-central-settings';
import { addDaysKey, isDayKey, jakartaTodayKey } from '@/lib/day-bucket';
import { normalizeBinCode, type BcFeedState } from '@/lib/bin-round';

/** BC's entity for the bin contents per location ("ppBinContentsAPI" — `ppBinContentsA…` in a cut-off link). */
export const BIN_LIST_ENTITY = 'ppBinContentsAPI';
const HEADERS_ENTITY = 'ppBinContentCheckHeaders';
const SCHEMA_VERSION = '2.0';

/** One page of the bin list can take a minute and a half on UAT. */
const BIN_LIST_TIMEOUT_MS = 180_000;
const HEADERS_TIMEOUT_MS = 45_000;

const query = (options: Array<[string, string]>) => options.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
const quote = (v: string) => `'${v.replace(/'/g, "''")}'`;

function errorText(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 500);
}

// ─── Bin list ────────────────────────────────────────────────────────────────

export interface StoreBinListEntry {
  binCode: string;
  itemLines: number;
  quantity: number;
}

export type StoreBinListResult =
  | { state: 'ok'; bins: StoreBinListEntry[] }
  | { state: 'not_configured' | 'unavailable'; bins: []; error: string };

/**
 * The bin-list endpoint as pasted into `.env.local`: the full entity URL (query/hash dropped, trailing slash
 * trimmed). A bare company root (`…/companies(<guid>)`) gets the entity appended.
 */
export function normalizeBinListEndpoint(raw: string): string {
  let url = raw.trim().replace(/^["']+|["']+$/g, '');
  url = url.split(/[?#]/, 1)[0].replace(/\/+$/, '');
  if (!url) return '';
  const last = url.slice(url.lastIndexOf('/') + 1);
  return last.toLowerCase().startsWith('companies(') ? `${url}/${BIN_LIST_ENTITY}` : url;
}

interface BinListConfig {
  endpoint: string;
  settings: ResolvedBusinessCentralSettings;
}

/** Read per call, so editing `.env.local` + restarting is all it takes. Null = not set up. */
export function resolveBinListConfig(env: NodeJS.ProcessEnv = process.env): BinListConfig | null {
  const clean = (v: string | undefined) => v?.trim() || '';
  const endpoint = normalizeBinListEndpoint(clean(env.BC_API_BIN_LIST_URL));
  const username = clean(env.BC_API_BIN_LIST_USERNAME) || clean(env.BC_API_BIN_USERNAME);
  const password = clean(env.BC_API_BIN_LIST_PASSWORD) || clean(env.BC_API_BIN_PASSWORD);
  if (!endpoint || !username || !password) return null;
  return { endpoint, settings: { apiUrl: endpoint, authType: 'basic', username, password, source: 'env' } };
}

export function binListUrl(endpoint: string, location: string): string {
  return `${endpoint}?${query([
    ['$select', 'binCode,quantityBase'],
    ['$schemaversion', SCHEMA_VERSION],
    ['$filter', `locationCode eq ${quote(location)}`],
  ])}`;
}

/** Raw ppBinContentsAPI rows → one entry per bin (bin-code order). */
export function groupBinListRows(rows: readonly unknown[]): StoreBinListEntry[] {
  const map = new Map<string, { itemLines: number; quantity: number }>();
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const r = row as { binCode?: unknown; quantityBase?: unknown };
    const code = typeof r.binCode === 'string' ? normalizeBinCode(r.binCode) : '';
    if (!code) continue;
    const entry = map.get(code) ?? { itemLines: 0, quantity: 0 };
    entry.itemLines += 1;
    const qty = Number(r.quantityBase);
    if (Number.isFinite(qty)) entry.quantity += qty;
    map.set(code, entry);
  }
  return [...map.entries()]
    .map(([binCode, e]) => ({ binCode, itemLines: e.itemLines, quantity: Math.round(e.quantity) }))
    .sort((a, b) => a.binCode.localeCompare(b.binCode, 'en', { numeric: true }));
}

export async function fetchStoreBinList(location: string): Promise<StoreBinListResult> {
  const loc = location.trim().toUpperCase();
  const config = resolveBinListConfig();
  if (!config) return { state: 'not_configured', bins: [], error: 'BC_API_BIN_LIST_URL (+ login BC_API_BIN_USERNAME / PASSWORD) belum diisi.' };
  if (!loc) return { state: 'unavailable', bins: [], error: 'Kode toko kosong.' };
  try {
    const rows = await fetchAllBusinessCentralRows(binListUrl(config.endpoint, loc), config.settings, {
      timeoutMs: BIN_LIST_TIMEOUT_MS,
    });
    return { state: 'ok', bins: groupBinListRows(rows) };
  } catch (err) {
    console.error(`[bin-round] ${BIN_LIST_ENTITY} ${loc} failed:`, errorText(err));
    return { state: 'unavailable', bins: [], error: errorText(err) };
  }
}

// ─── Scan results of a period ────────────────────────────────────────────────

export interface RoundHeadersResult {
  state: BcFeedState;
  headers: unknown[];
}

export function roundHeadersUrl(baseUrl: string, from: string, to: string, locations: readonly string[]): string {
  const filter = [`date ge ${from}`, `date lt ${addDaysKey(to, 1)}`];
  if (locations.length === 1) filter.unshift(`location eq ${quote(locations[0])}`);
  else if (locations.length > 1) filter.unshift(`location in (${locations.map(quote).join(',')})`);
  return `${baseUrl}${HEADERS_ENTITY}?${query([
    ['$select', 'location,date,binCode,checked'],
    [
      '$expand',
      'ppBinContentCheckLines($select=binCode,itemNo,variantCode,unitOfMeasureCode,actualBinCodes,scanQuantity,binQuantity,binContentCheckStatus)',
    ],
    ['$schemaversion', SCHEMA_VERSION],
    ['$filter', filter.join(' and ')],
  ])}`;
}

const cache = new Map<string, { at: number; ttl: number; value: Promise<RoundHeadersResult> }>();

/**
 * Every Cek Bin scan (+ lines) between `from` and `to` (Jakarta days, inclusive) for `locations` (empty = every
 * location). Cached a little (shorter while the period includes today); failures are not cached.
 */
export async function fetchRoundCheckHeaders(params: {
  from: string;
  to: string;
  locations?: readonly string[];
  force?: boolean;
}): Promise<RoundHeadersResult> {
  const { from, to } = params;
  const locations = [...new Set((params.locations ?? []).map((l) => l.trim().toUpperCase()).filter(Boolean))].sort();
  const config = resolveBinCheckConfig();
  if (!config) return { state: 'not_configured', headers: [] };
  if (!isDayKey(from) || !isDayKey(to) || from > to) return { state: 'unavailable', headers: [] };

  const key = `${from}|${to}|${locations.join(',')}`;
  const hit = cache.get(key);
  const age = hit ? Date.now() - hit.at : Infinity;
  if (hit && age < hit.ttl && !(params.force && age > 10_000)) return hit.value;

  const value = (async (): Promise<RoundHeadersResult> => {
    try {
      const headers = await fetchAllBusinessCentralRows(roundHeadersUrl(config.baseUrl, from, to, locations), config.settings, {
        timeoutMs: HEADERS_TIMEOUT_MS,
      });
      return { state: 'ok', headers };
    } catch (err) {
      console.error(`[bin-round] ${HEADERS_ENTITY} ${from}..${to} failed:`, errorText(err));
      return { state: 'unavailable', headers: [] };
    }
  })();
  if (cache.size > 100) cache.clear();
  cache.set(key, { at: Date.now(), ttl: to >= jakartaTodayKey() ? 45_000 : 10 * 60_000, value });
  void value.then((r) => {
    if (r.state !== 'ok' && cache.get(key)?.value === value) cache.delete(key);
  });
  return value;
}
