// lib/db/utils/bin-round.ts
// ─────────────────────────────────────────────────────────────────────────────
// Cek Bin · monthly bin round — the DB side (rules + shapes: lib/bin-round.ts; BC reads: lib/bc/bin-round.ts;
// tables: lib/db/schema/bin-rounds.ts).
//
//   Bin list      requestBinListSync()   reads a store's bins from BC IN THE BACKGROUND (claimed per store in
//                                        store_bin_syncs, so two processes never read the same store at once; at
//                                        most BIN_LIST_CONCURRENCY at a time) into store_bin_codes, about once a day.
//   Month         ensureCurrentMonths()  one bin_check_months row per store per month + one bin row per bin from
//                                        the store's list; a new month starts with every bin pending again. Only
//                                        the CURRENT month is filled from the list — a past month keeps what it had.
//   Results       syncMonthResults()     BC's scans of the month so far (one query for every store asked) →
//                                        each bin's first / last result, then the month's saved totals.
//                                        A month is read one last time after it ends and frozen (finalized_at).
//   Day list      createDailyList()      the day's 20 bins (pickDailyBins), under a per-store advisory lock so two
//                                        colleagues opening the task at once get ONE list.
//
// Timestamps are written as JS Dates (raw SQL gets ISO strings) — the DB session runs on Jakarta time and the
// columns have no timezone, so a SQL now() would read back 7 h off through Drizzle.
// ─────────────────────────────────────────────────────────────────────────────

import { and, asc, eq, inArray, isNotNull, isNull, lt, or, sql, type SQL } from 'drizzle-orm';

import { db } from '@/lib/db';
import {
  areas,
  binCheckAssignments,
  binCheckMonthBins,
  binCheckMonths,
  storeBinCodes,
  storeBinSyncs,
  stores,
  type BinCheckMonth,
} from '@/lib/db/schema';
import { jakartaTodayKey } from '@/lib/day-bucket';
import { fetchRoundCheckHeaders, fetchStoreBinList } from '@/lib/bc/bin-round';
import {
  DAILY_BIN_COUNT,
  EXCLUDED_BIN_CODES,
  collectBinChecks,
  compareBinCodes,
  dailyCounts,
  foldBinChecks,
  isExcludedBin,
  isMonthFinal,
  monthBounds,
  pickDailyBins,
  roundSeed,
  shiftYearMonth,
  yearMonthOfDay,
  type BcFeedState,
  type BinListSync,
  type BinMonthStats,
  type BinProgressBin,
  type BinProgressDetail,
  type BinProgressOverview,
  type BinProgressStoreRow,
  type DailyBinList,
  type EmployeeBinRound,
} from '@/lib/bin-round';
import { getHiddenStores, notHiddenStore } from '@/lib/db/utils/it-only-stores';

export interface RoundStore {
  id: number;
  storeNo: string;
  name: string;
  areaId: number | null;
  areaName: string | null;
}

type SyncRow = typeof storeBinSyncs.$inferSelect;
type StoreRef = Pick<RoundStore, 'id' | 'storeNo'>;

/** The bin list is read again after this long. */
const BIN_LIST_MAX_AGE_MS = 20 * 3_600_000;
/** A read claimed / started this recently is "in progress" (and blocks another); a dead process frees it after. */
const SYNC_CLAIM_MS = 30 * 60_000;
/** After a failed read, wait this long before trying again by itself. */
const FAILED_RETRY_MS = 30 * 60_000;
/** BC's scans are read again after this long. */
const RESULTS_MAX_AGE_MS = 60_000;
const BIN_LIST_CONCURRENCY = 3;
/** pg_advisory_xact_lock(namespace, store id) around making a day's list. */
const LOCK_NAMESPACE = 73_011;

const iso = (d: Date) => d.toISOString();

/** SQL twin of isExcludedBin() for a bin-code column — exact codes (stored normalised: upper-case, trimmed). */
function excludedBinSql(column: SQL): SQL {
  return sql`${column} IN (${sql.join(EXCLUDED_BIN_CODES.map((c) => sql`${c}`), sql`, `)})`;
}

function chunks<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

// ─── Stores ──────────────────────────────────────────────────────────────────

/** Active stores (only they do tasks), optionally one area, in store-code order. */
export async function listRoundStores(filter: { areaId?: number | null; storeId?: number } = {}): Promise<RoundStore[]> {
  const where = [eq(stores.status, 'active')];
  if (filter.areaId != null) where.push(eq(stores.areaId, filter.areaId));
  if (filter.storeId != null) where.push(eq(stores.id, filter.storeId));
  // IT-only test stores (DUMMY…) are hidden from non-IT viewers; cron (no session) keeps them.
  where.push(notHiddenStore(stores.id, (await getHiddenStores()).storeIds));
  const rows = await db
    .select({ id: stores.id, storeNo: stores.storeNo, name: stores.name, areaId: stores.areaId, areaName: areas.name })
    .from(stores)
    .leftJoin(areas, eq(areas.id, stores.areaId))
    .where(and(...where))
    .orderBy(asc(stores.storeNo));
  return rows.map((r) => ({ ...r, areaName: r.areaName ?? null }));
}

// ─── Bin list (background) ───────────────────────────────────────────────────

export function toBinListSync(row: SyncRow | undefined, now = Date.now()): BinListSync {
  if (!row) return { state: 'never', syncedAt: null, binCount: null, error: null };
  const attempted = row.attemptedAt?.getTime() ?? 0;
  const synced = row.syncedAt?.getTime() ?? 0;
  const running = attempted > 0 && attempted > synced && !row.error && now - attempted < SYNC_CLAIM_MS;
  return {
    state: running ? 'syncing' : row.error ? 'failed' : row.syncedAt ? 'ok' : 'never',
    syncedAt: row.syncedAt ? iso(row.syncedAt) : null,
    binCount: row.binCount ?? null,
    error: row.error ?? null,
  };
}

/** Should the store's list be read (again) without anybody asking? */
export function needsBinListSync(row: SyncRow | undefined, now = Date.now()): boolean {
  if (!row) return true;
  const state = toBinListSync(row, now).state;
  if (state === 'syncing') return false;
  if (row.error) return now - (row.attemptedAt?.getTime() ?? 0) > FAILED_RETRY_MS;
  if (!row.syncedAt) return true;
  return now - row.syncedAt.getTime() > BIN_LIST_MAX_AGE_MS;
}

async function claimBinListSync(storeId: number, force: boolean): Promise<boolean> {
  const now = new Date();
  await db.insert(storeBinSyncs).values({ storeId }).onConflictDoNothing();
  const notRunning = or(
    isNull(storeBinSyncs.attemptedAt),
    lt(storeBinSyncs.attemptedAt, new Date(now.getTime() - SYNC_CLAIM_MS)),
    isNotNull(storeBinSyncs.error),
    sql`${storeBinSyncs.syncedAt} >= ${storeBinSyncs.attemptedAt}`,
  );
  const conds = [eq(storeBinSyncs.storeId, storeId), notRunning];
  if (!force) {
    conds.push(or(isNull(storeBinSyncs.syncedAt), lt(storeBinSyncs.syncedAt, new Date(now.getTime() - BIN_LIST_MAX_AGE_MS))));
    conds.push(or(isNull(storeBinSyncs.error), lt(storeBinSyncs.attemptedAt, new Date(now.getTime() - FAILED_RETRY_MS))));
  }
  const claimed = await db
    .update(storeBinSyncs)
    .set({ attemptedAt: now, error: null })
    .where(and(...conds))
    .returning({ storeId: storeBinSyncs.storeId });
  return claimed.length > 0;
}

/** Reads the store's bins from BC into store_bin_codes, then into the current month. The claim is already held. */
async function runBinListSync(store: StoreRef): Promise<void> {
  try {
    // The claim was taken when it was queued; renew it now the read really starts.
    await db.update(storeBinSyncs).set({ attemptedAt: new Date() }).where(eq(storeBinSyncs.storeId, store.id));
    const res = await fetchStoreBinList(store.storeNo);
    if (res.state !== 'ok') {
      await db.update(storeBinSyncs).set({ error: res.error || 'BC tidak menjawab.' }).where(eq(storeBinSyncs.storeId, store.id));
      return;
    }
    const now = new Date();
    for (const part of chunks(res.bins, 500)) {
      await db
        .insert(storeBinCodes)
        .values(part.map((b) => ({ storeId: store.id, binCode: b.binCode, itemLines: b.itemLines, quantity: b.quantity, isActive: true, firstSeenAt: now, lastSeenAt: now })))
        .onConflictDoUpdate({
          target: [storeBinCodes.storeId, storeBinCodes.binCode],
          set: { itemLines: sql`excluded.item_lines`, quantity: sql`excluded.quantity`, isActive: true, lastSeenAt: now },
        });
    }
    // Bins BC no longer lists.
    await db
      .update(storeBinCodes)
      .set({ isActive: false })
      .where(and(eq(storeBinCodes.storeId, store.id), eq(storeBinCodes.isActive, true), lt(storeBinCodes.lastSeenAt, now)));
    await db.update(storeBinSyncs).set({ syncedAt: new Date(), binCount: res.bins.length, error: null }).where(eq(storeBinSyncs.storeId, store.id));

    const [sync] = await db.select().from(storeBinSyncs).where(eq(storeBinSyncs.storeId, store.id)).limit(1);
    await ensureCurrentMonths([store.id], yearMonthOfDay(jakartaTodayKey()), new Map([[store.id, sync]]));
  } catch (err) {
    console.error(`[bin-round] bin list sync ${store.storeNo} failed:`, err);
    await db
      .update(storeBinSyncs)
      .set({ error: (err instanceof Error ? err.message : String(err)).slice(0, 500) })
      .where(eq(storeBinSyncs.storeId, store.id))
      .catch(() => undefined);
  }
}

// One queue per process (route bundles share it through globalThis, like the pg pool).
const g = globalThis as unknown as { __binListQueue?: { queue: StoreRef[]; running: number } };
const q = (g.__binListQueue ??= { queue: [], running: 0 });

function pump(): void {
  while (q.running < BIN_LIST_CONCURRENCY && q.queue.length) {
    const store = q.queue.shift()!;
    q.running += 1;
    void runBinListSync(store).finally(() => {
      q.running -= 1;
      pump();
    });
  }
}

/**
 * Queues a BC read of these stores' bin lists (those not read recently, or all with `force`) and returns at once
 * with the ids that were queued. Never throws.
 */
export async function requestBinListSync(list: readonly StoreRef[], opts: { force?: boolean } = {}): Promise<number[]> {
  const queued: number[] = [];
  for (const store of list) {
    try {
      if (q.queue.some((s) => s.id === store.id)) continue;
      if (!(await claimBinListSync(store.id, !!opts.force))) continue;
      q.queue.push({ id: store.id, storeNo: store.storeNo });
      queued.push(store.id);
    } catch (err) {
      console.error(`[bin-round] could not queue ${store.storeNo}:`, err);
    }
  }
  pump();
  return queued;
}

/** Scripts / tests: read one store's list now and wait for it. */
export async function syncBinListNow(store: StoreRef): Promise<BinListSync> {
  if (await claimBinListSync(store.id, true)) await runBinListSync(store);
  const [row] = await db.select().from(storeBinSyncs).where(eq(storeBinSyncs.storeId, store.id)).limit(1);
  return toBinListSync(row);
}

// ─── Months ──────────────────────────────────────────────────────────────────

export function statsOf(m: Pick<BinCheckMonth, 'totalBins' | 'checkedBins' | 'correctBins' | 'wrongBins' | 'fixedBins'>): BinMonthStats {
  return { totalBins: m.totalBins, checkedBins: m.checkedBins, correctBins: m.correctBins, wrongBins: m.wrongBins, fixedBins: m.fixedBins };
}

async function readMonths(storeIds: readonly number[], ym: string): Promise<BinCheckMonth[]> {
  if (!storeIds.length) return [];
  return db
    .select()
    .from(binCheckMonths)
    .where(and(eq(binCheckMonths.yearMonth, ym), inArray(binCheckMonths.storeId, [...storeIds])));
}

/** Saved totals of the months from their bin rows. */
async function recomputeTotals(monthIds: readonly number[], opts: { resultsSynced?: boolean } = {}): Promise<void> {
  if (!monthIds.length) return;
  const now = iso(new Date());
  for (const part of chunks(monthIds, 500)) {
    const ids = sql.join(part.map((id) => sql`${id}`), sql`, `);
    await db.execute(sql`
      UPDATE bin_check_months m SET
        total_bins = s.total, checked_bins = s.checked, correct_bins = s.correct, wrong_bins = s.wrong,
        fixed_bins = s.fixed, updated_at = ${now}
        ${opts.resultsSynced ? sql`, results_synced_at = ${now}` : sql``}
      FROM bin_check_months m2
      CROSS JOIN LATERAL (
        SELECT
          count(*) FILTER (WHERE b.in_bc OR b.status <> 'pending')::int AS total,
          count(*) FILTER (WHERE b.status <> 'pending')::int AS checked,
          count(*) FILTER (WHERE b.status = 'correct')::int AS correct,
          count(*) FILTER (WHERE b.status = 'wrong')::int AS wrong,
          count(*) FILTER (WHERE b.status = 'wrong' AND b.last_result = 'correct' AND b.last_checked_on > b.first_checked_on)::int AS fixed
        FROM bin_check_month_bins b WHERE b.month_id = m2.id
      ) s
      WHERE m.id = m2.id AND m.id IN (${ids})`);
  }
}

/** Copies the store's current BC bin list into the month (new bins in; bins BC dropped marked out). */
async function fillMonthBins(month: BinCheckMonth): Promise<void> {
  const now = iso(new Date());
  await db.execute(sql`
    INSERT INTO bin_check_month_bins (month_id, store_id, year_month, bin_code, in_bc, status, created_at, updated_at)
    SELECT ${month.id}, ${month.storeId}, ${month.yearMonth}, c.bin_code, true, 'pending', ${now}, ${now}
    FROM store_bin_codes c
    WHERE c.store_id = ${month.storeId} AND c.is_active AND NOT ${excludedBinSql(sql`c.bin_code`)}
    ON CONFLICT (store_id, year_month, bin_code) DO UPDATE SET in_bc = true, updated_at = EXCLUDED.updated_at
      WHERE bin_check_month_bins.in_bc = false`);
  await db.execute(sql`
    UPDATE bin_check_month_bins b SET in_bc = false, updated_at = ${now}
    WHERE b.month_id = ${month.id} AND b.in_bc
      AND NOT EXISTS (SELECT 1 FROM store_bin_codes c WHERE c.store_id = b.store_id AND c.bin_code = b.bin_code AND c.is_active)`);
  await db.update(binCheckMonths).set({ binsFilledAt: new Date() }).where(eq(binCheckMonths.id, month.id));
}

// Open months this process already brought in line with EXCLUDED_BIN_CODES (the rule only changes with a deploy).
const ruledMonths = ((globalThis as unknown as { __binRoundRuled?: Set<number> }).__binRoundRuled ??= new Set<number>());

/**
 * Once per process per open month: drops bins the rule leaves out (and their day-list rows), refills the month from
 * the store's BC list — which adds back bins an older rule left out (2026-11-19: DISPLAY-xx, BOOKING, RECEIVING,
 * SHIPPING) — and has BC's scans read again so those bins get their results back. Returns the months it refilled.
 */
async function applyBinRules(months: readonly BinCheckMonth[], syncById: ReadonlyMap<number, SyncRow | undefined>): Promise<number[]> {
  const open = months.filter((m) => !m.finalizedAt && !ruledMonths.has(m.id) && !!syncById.get(m.storeId)?.syncedAt);
  if (!open.length) return [];
  const ids = sql.join(open.map((m) => sql`${m.id}`), sql`, `);
  await db.execute(sql`DELETE FROM bin_check_month_bins b WHERE b.month_id IN (${ids}) AND ${excludedBinSql(sql`b.bin_code`)}`);
  await db.execute(sql`
    DELETE FROM bin_check_assignments a USING bin_check_months m
    WHERE m.id IN (${ids}) AND a.store_id = m.store_id AND a.year_month = m.year_month AND ${excludedBinSql(sql`a.bin_code`)}`);
  for (const m of open) {
    await fillMonthBins(m);
    ruledMonths.add(m.id);
  }
  await db.update(binCheckMonths).set({ resultsSyncedAt: null }).where(inArray(binCheckMonths.id, open.map((m) => m.id)));
  return open.map((m) => m.id);
}

/**
 * The CURRENT month's rows for stores whose bin list has been read: created when missing, refilled when the list
 * was read again since. Stores without a list get no month (shown as "Belum ada daftar bin").
 */
export async function ensureCurrentMonths(storeIds: readonly number[], ym: string, syncById: ReadonlyMap<number, SyncRow | undefined>): Promise<void> {
  const ready = storeIds.filter((id) => !!syncById.get(id)?.syncedAt);
  if (!ready.length) return;
  let months = await readMonths(ready, ym);
  const missing = ready.filter((id) => !months.some((m) => m.storeId === id));
  if (missing.length) {
    const now = new Date();
    await db
      .insert(binCheckMonths)
      .values(missing.map((storeId) => ({ storeId, yearMonth: ym, createdAt: now, updatedAt: now })))
      .onConflictDoNothing();
    months = await readMonths(ready, ym);
  }
  const refilled: number[] = await applyBinRules(months, syncById);
  for (const m of months) {
    const syncedAt = syncById.get(m.storeId)?.syncedAt;
    if (refilled.includes(m.id) || !syncedAt || (m.binsFilledAt && m.binsFilledAt >= syncedAt)) continue;
    await fillMonthBins(m);
    refilled.push(m.id);
  }
  await recomputeTotals(refilled);
}

// ─── Results ─────────────────────────────────────────────────────────────────

/**
 * Reads BC's scans of `ym` (up to today) for the stores that have a month row and folds them into their bins +
 * totals. Months read less than a minute ago, and frozen months, are skipped. Returns BC's state (null = nothing
 * was asked, e.g. a month without rows).
 */
export async function syncMonthResults(params: { yearMonth: string; stores: readonly StoreRef[]; force?: boolean; today?: string }): Promise<BcFeedState | null> {
  const today = params.today ?? jakartaTodayKey();
  const bounds = monthBounds(params.yearMonth, today);
  if (!bounds || !params.stores.length) return null;

  const months = (await readMonths(params.stores.map((s) => s.id), params.yearMonth)).filter((m) => !m.finalizedAt);
  if (!months.length) return null;
  const now = Date.now();
  const stale = months.filter((m) => params.force || !m.resultsSyncedAt || now - m.resultsSyncedAt.getTime() > RESULTS_MAX_AGE_MS);
  if (!stale.length) return 'ok';

  const codeById = new Map(params.stores.map((s) => [s.id, s.storeNo.trim().toUpperCase()]));
  const locations = stale.map((m) => codeById.get(m.storeId)).filter((c): c is string => !!c);
  const bc = await fetchRoundCheckHeaders({
    from: bounds.from,
    to: bounds.to,
    // A long `location in (…)` list is slower than asking for everything once.
    locations: locations.length <= 25 ? locations : [],
    force: params.force,
  });
  if (bc.state !== 'ok') return bc.state;

  const checks = collectBinChecks(bc.headers, bounds.from, bounds.to);
  const stamp = new Date();
  for (const m of stale) {
    const byBin = checks.get(codeById.get(m.storeId) ?? '');
    if (!byBin) continue;
    const rows = [];
    for (const [binCode, list] of byBin) {
      if (isExcludedBin(binCode)) continue;
      const f = foldBinChecks(list);
      if (!f) continue;
      rows.push({
        monthId: m.id,
        storeId: m.storeId,
        yearMonth: m.yearMonth,
        binCode,
        inBc: true,
        status: f.status,
        firstCheckedOn: f.firstCheckedOn,
        firstWrongCount: f.firstWrongCount,
        wrongLines: f.wrongLines,
        lastCheckedOn: f.lastCheckedOn,
        lastResult: f.lastResult,
        checkDays: f.checkDays,
        createdAt: stamp,
        updatedAt: stamp,
      });
    }
    for (const part of chunks(rows, 300)) {
      await db
        .insert(binCheckMonthBins)
        .values(part)
        .onConflictDoUpdate({
          target: [binCheckMonthBins.storeId, binCheckMonthBins.yearMonth, binCheckMonthBins.binCode],
          set: {
            status: sql`excluded.status`,
            firstCheckedOn: sql`excluded.first_checked_on`,
            firstWrongCount: sql`excluded.first_wrong_count`,
            wrongLines: sql`excluded.wrong_lines`,
            lastCheckedOn: sql`excluded.last_checked_on`,
            lastResult: sql`excluded.last_result`,
            checkDays: sql`excluded.check_days`,
            updatedAt: sql`excluded.updated_at`,
          },
        });
    }
  }
  await recomputeTotals(stale.map((m) => m.id), { resultsSynced: true });
  return 'ok';
}

/** A month that is over: read it one last time and freeze it. */
async function finalizeMonth(ym: string, list: readonly StoreRef[], today: string): Promise<BcFeedState | null> {
  if (!isMonthFinal(ym, today)) return syncMonthResults({ yearMonth: ym, stores: list, today });
  const open = (await readMonths(list.map((s) => s.id), ym)).filter((m) => !m.finalizedAt);
  if (!open.length) return null;
  const state = await syncMonthResults({ yearMonth: ym, stores: list, force: true, today });
  if (state === 'ok') {
    await db
      .update(binCheckMonths)
      .set({ finalizedAt: new Date() })
      .where(inArray(binCheckMonths.id, open.map((m) => m.id)));
  }
  return state;
}

// ─── The day's list ──────────────────────────────────────────────────────────

export async function readDailyList(storeId: number, day: string): Promise<DailyBinList | null> {
  const rows = await db
    .select({
      position: binCheckAssignments.position,
      binCode: binCheckAssignments.binCode,
      status: binCheckMonthBins.status,
      checkedOn: binCheckMonthBins.firstCheckedOn,
      wrongCount: binCheckMonthBins.firstWrongCount,
    })
    .from(binCheckAssignments)
    .leftJoin(
      binCheckMonthBins,
      and(
        eq(binCheckMonthBins.storeId, binCheckAssignments.storeId),
        eq(binCheckMonthBins.yearMonth, binCheckAssignments.yearMonth),
        eq(binCheckMonthBins.binCode, binCheckAssignments.binCode),
      ),
    )
    .where(and(eq(binCheckAssignments.storeId, storeId), eq(binCheckAssignments.checkDate, day)))
    .orderBy(asc(binCheckAssignments.position));
  if (!rows.length) return null;
  // Numbered 1…n as shown (a bin taken out of a made list — applyBinRules — leaves no gap).
  const bins = rows.map((r, i) => {
    const status = r.status ?? 'pending';
    return { position: i + 1, binCode: r.binCode, status, checkedOn: r.checkedOn ?? null, wrongCount: status === 'wrong' ? (r.wrongCount ?? 0) : 0 };
  });
  return { day, bins, ...dailyCounts(bins) };
}

/** Makes the day's list once (per-store lock). `allChecked` = nothing pending was left to hand out. */
export async function createDailyList(storeId: number, day: string): Promise<{ list: DailyBinList | null; allChecked: boolean }> {
  const ym = yearMonthOfDay(day);
  const outcome = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${LOCK_NAMESPACE}::int, ${storeId}::int)`);
    const [exists] = await tx
      .select({ id: binCheckAssignments.id })
      .from(binCheckAssignments)
      .where(and(eq(binCheckAssignments.storeId, storeId), eq(binCheckAssignments.checkDate, day)))
      .limit(1);
    if (exists) return 'exists' as const;
    const pool = await tx
      .select({ binCode: binCheckMonthBins.binCode, timesAssigned: binCheckMonthBins.timesAssigned })
      .from(binCheckMonthBins)
      .where(
        and(
          eq(binCheckMonthBins.storeId, storeId),
          eq(binCheckMonthBins.yearMonth, ym),
          eq(binCheckMonthBins.status, 'pending'),
          eq(binCheckMonthBins.inBc, true),
        ),
      );
    const codes = pickDailyBins(pool, roundSeed(storeId, day), DAILY_BIN_COUNT);
    if (!codes.length) return 'empty' as const;
    const now = new Date();
    await tx
      .insert(binCheckAssignments)
      .values(codes.map((binCode, i) => ({ storeId, checkDate: day, yearMonth: ym, binCode, position: i + 1, createdAt: now })))
      .onConflictDoNothing();
    await tx
      .update(binCheckMonthBins)
      .set({
        timesAssigned: sql`${binCheckMonthBins.timesAssigned} + 1`,
        lastAssignedOn: day,
        firstAssignedOn: sql`coalesce(${binCheckMonthBins.firstAssignedOn}, ${day}::date)`,
        updatedAt: now,
      })
      .where(and(eq(binCheckMonthBins.storeId, storeId), eq(binCheckMonthBins.yearMonth, ym), inArray(binCheckMonthBins.binCode, codes)));
    return 'created' as const;
  });
  return { list: await readDailyList(storeId, day), allChecked: outcome === 'empty' };
}

// ─── What the pages get ──────────────────────────────────────────────────────

async function readSyncRows(storeIds: readonly number[]): Promise<Map<number, SyncRow>> {
  if (!storeIds.length) return new Map();
  const rows = await db.select().from(storeBinSyncs).where(inArray(storeBinSyncs.storeId, [...storeIds]));
  return new Map(rows.map((r) => [r.storeId, r]));
}

/**
 * Brings `ym` up to date for these stores: current month → queue stale bin lists, make/refill month rows, read
 * BC's scans; a past month → read it a last time and freeze it once it is over.
 */
async function refreshMonth(list: readonly RoundStore[], ym: string, today: string, force: boolean) {
  const syncById = await readSyncRows(list.map((s) => s.id));
  let resultsState: BcFeedState | null = null;
  if (ym === yearMonthOfDay(today)) {
    const stale = list.filter((s) => needsBinListSync(syncById.get(s.id)));
    if (stale.length) await requestBinListSync(stale);
    await ensureCurrentMonths(list.map((s) => s.id), ym, syncById);
    resultsState = await syncMonthResults({ yearMonth: ym, stores: list, force, today });
  } else if (ym < yearMonthOfDay(today)) {
    resultsState = await finalizeMonth(ym, list, today);
  }
  return { syncById: await readSyncRows(list.map((s) => s.id)), resultsState };
}

export async function getBinProgressOverview(params: { yearMonth: string; stores: readonly RoundStore[]; force?: boolean }): Promise<BinProgressOverview> {
  const today = jakartaTodayKey();
  const ym = params.yearMonth;
  const ids = params.stores.map((s) => s.id);
  const { syncById, resultsState } = await refreshMonth(params.stores, ym, today, !!params.force);
  const months = new Map((await readMonths(ids, ym)).map((m) => [m.storeId, m]));

  const todayCounts = new Map<number, { assigned: number; checked: number }>();
  if (ym === yearMonthOfDay(today) && ids.length) {
    const rows = await db
      .select({
        storeId: binCheckAssignments.storeId,
        assigned: sql<number>`count(*)::int`,
        checked: sql<number>`count(${binCheckMonthBins.id}) FILTER (WHERE ${binCheckMonthBins.status} <> 'pending')::int`,
      })
      .from(binCheckAssignments)
      .leftJoin(
        binCheckMonthBins,
        and(
          eq(binCheckMonthBins.storeId, binCheckAssignments.storeId),
          eq(binCheckMonthBins.yearMonth, binCheckAssignments.yearMonth),
          eq(binCheckMonthBins.binCode, binCheckAssignments.binCode),
        ),
      )
      .where(and(eq(binCheckAssignments.checkDate, today), inArray(binCheckAssignments.storeId, ids)))
      .groupBy(binCheckAssignments.storeId);
    for (const r of rows) todayCounts.set(r.storeId, { assigned: Number(r.assigned), checked: Number(r.checked) });
  }

  const rows: BinProgressStoreRow[] = params.stores.map((s) => {
    const m = months.get(s.id);
    return {
      storeId: s.id,
      storeNo: s.storeNo,
      storeName: s.name,
      areaId: s.areaId,
      areaName: s.areaName,
      stats: m ? statsOf(m) : null,
      binList: toBinListSync(syncById.get(s.id)),
      today: ym === yearMonthOfDay(today) ? (todayCounts.get(s.id) ?? { assigned: 0, checked: 0 }) : null,
      finalizedAt: m?.finalizedAt ? iso(m.finalizedAt) : null,
    };
  });
  return { yearMonth: ym, today, resultsState, rows };
}

export async function getBinProgressDetail(params: { store: RoundStore; yearMonth: string; force?: boolean }): Promise<BinProgressDetail> {
  const today = jakartaTodayKey();
  const { store, yearMonth: ym } = params;
  const { syncById, resultsState } = await refreshMonth([store], ym, today, !!params.force);
  const [month] = await readMonths([store.id], ym);

  let bins: BinProgressBin[] = [];
  if (month) {
    const rows = await db
      .select({ b: binCheckMonthBins, itemLines: storeBinCodes.itemLines, quantity: storeBinCodes.quantity })
      .from(binCheckMonthBins)
      .leftJoin(storeBinCodes, and(eq(storeBinCodes.storeId, binCheckMonthBins.storeId), eq(storeBinCodes.binCode, binCheckMonthBins.binCode)))
      .where(eq(binCheckMonthBins.monthId, month.id));
    bins = rows
      // A bin BC dropped before anyone checked it is not part of the month.
      .filter(({ b }) => b.inBc || b.status !== 'pending')
      .map(({ b, itemLines, quantity }) => ({
        binCode: b.binCode,
        inBc: b.inBc,
        status: b.status,
        firstCheckedOn: b.firstCheckedOn,
        firstWrongCount: b.firstWrongCount,
        wrongLines: Array.isArray(b.wrongLines) ? b.wrongLines : [],
        lastCheckedOn: b.lastCheckedOn,
        lastResult: b.lastResult ?? null,
        checkDays: b.checkDays,
        timesAssigned: b.timesAssigned,
        lastAssignedOn: b.lastAssignedOn,
        itemLines: itemLines ?? null,
        quantity: quantity ?? null,
      }));
  }

  return {
    store: { id: store.id, storeNo: store.storeNo, name: store.name, areaName: store.areaName },
    yearMonth: ym,
    today,
    stats: month ? statsOf(month) : null,
    binList: toBinListSync(syncById.get(store.id)),
    resultsState,
    bins,
    todayList: ym === yearMonthOfDay(today) ? await readDailyList(store.id, today) : null,
    finalizedAt: month?.finalizedAt ? iso(month.finalizedAt) : null,
    excludedBins: await readExcludedBins(store.id),
  };
}

/** The store's bins in BC now that the round leaves out (the bare DISPLAY bin), in bin-code order. */
async function readExcludedBins(storeId: number): Promise<string[]> {
  const rows = await db
    .select({ binCode: storeBinCodes.binCode })
    .from(storeBinCodes)
    .where(and(eq(storeBinCodes.storeId, storeId), eq(storeBinCodes.isActive, true), excludedBinSql(sql`${storeBinCodes.binCode}`)));
  return rows.map((r) => r.binCode).sort(compareBinCodes);
}

/**
 * The staff Cek Bin page: the day's 20 bins (made the first time somebody opens the task TODAY, after BC's scans
 * so far were read — a bin scanned this morning is never handed out), with their state, plus the month so far.
 */
export async function getEmployeeBinRound(store: RoundStore, day: string): Promise<EmployeeBinRound> {
  const today = jakartaTodayKey();
  const ym = yearMonthOfDay(day);
  const { syncById, resultsState } = await refreshMonth([store], ym, today, false);
  const [month] = await readMonths([store.id], ym);
  const sync = toBinListSync(syncById.get(store.id));

  let list = await readDailyList(store.id, day);
  let allChecked = false;
  if (month) {
    if (!list && day === today) ({ list, allChecked } = await createDailyList(store.id, day));
    if (!list) allChecked = month.totalBins > 0 && month.checkedBins >= month.totalBins;
  }
  const [fresh] = month ? await readMonths([store.id], ym) : [];

  return {
    state: month ? (fresh && fresh.totalBins === 0 ? 'no_bins' : 'ok') : sync.state === 'failed' ? 'failed' : 'preparing',
    day,
    perDay: DAILY_BIN_COUNT,
    list,
    month: fresh ? statsOf(fresh) : null,
    resultsState,
    allChecked,
  };
}

/**
 * The cron: every active store → stale bin lists queued, current month brought up to date, last month frozen once
 * it is over. Returns what it did.
 */
export async function runBinRoundCron(): Promise<{ stores: number; queued: number; current: BcFeedState | null; previous: BcFeedState | null }> {
  const today = jakartaTodayKey();
  const list = await listRoundStores();
  const syncById = await readSyncRows(list.map((s) => s.id));
  const stale = list.filter((s) => needsBinListSync(syncById.get(s.id)));
  const queued = stale.length ? await requestBinListSync(stale) : [];
  const ym = yearMonthOfDay(today);
  await ensureCurrentMonths(list.map((s) => s.id), ym, syncById);
  const current = await syncMonthResults({ yearMonth: ym, stores: list, today });
  const previous = await finalizeMonth(shiftYearMonth(ym, -1), list, today);
  return { stores: list.length, queued: queued.length, current, previous };
}
