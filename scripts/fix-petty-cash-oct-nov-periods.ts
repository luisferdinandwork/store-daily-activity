// scripts/fix-petty-cash-oct-nov-periods.ts
//
// One-off data fix for the switch to calendar-driven petty cash periods (2026-11-10).
//
// Before that switch a store had ONE period row ("2026-10") that kept collecting every request until a refill
// closed it, and a refill was labelled with the month it was FILED in. Nothing re-sorted that old data into the
// new windows, so today:
//   • usage from 16 Oct onwards (it belongs to the November period, 16 Oct – 15 Nov) still sits in the October row;
//   • stores the app has already moved forward got an empty November row at Rp 1.000.000 while October holds the
//     cash they really used since the 16th — and the October Refill they are offered is flagged "Terlambat" for
//     money that is not late at all;
//   • refill requests carry a label that does not match the period whose usage they pay.
//
// What it does, per ACTIVE store (DUMMY* stores are skipped), once:
//   1. every COMPLETED request goes to the period of the day it was confirmed (--bucket=confirmed, default: the day the
//      amount was cut from the balance — what the app does from now on) or filed (--bucket=filed); requests still
//      waiting (pending_ops / ops_approved) go to November (the period in use); rejected-by-Ops ones stay put;
//   2. October is CLOSED with balance = Rp 1.000.000 − what it used; November is OPEN (created if missing) with
//      Rp 1.000.000 − what it used (Oct → Nov carries nothing: carry only exists from the 2026-11 period on);
//   3. the store's open refill request (OPS-approved, not verified) is labelled with the period whose usage it pays
//      (October if it has any, else November) and gets that period's balance as `balance_before`;
//   4. with --verify (+ --actor=<NIK of a Finance/IT user>) those requests are also VERIFIED the way Finance does it
//      on the Petty Cash page: financeVerifiedBy/At, transferAmount frozen = Rp 1.000.000 − the period's balance,
//      rejectedCount/Amount, and the "Refill sudah diproses Finance" notification to PIC 1 (--no-notify skips it).
//      Receiving stays PIC 1's job (two proof photos) — this script never sets balance_after.
//
//   npx tsx scripts/fix-petty-cash-oct-nov-periods.ts                       # DRY RUN (read-only transaction)
//   npx tsx scripts/fix-petty-cash-oct-nov-periods.ts --store=FF004,FS029   # only these stores
//   npx tsx scripts/fix-petty-cash-oct-nov-periods.ts --apply --confirm=<database-name>
//   npx tsx scripts/fix-petty-cash-oct-nov-periods.ts --apply --confirm=<db> --verify --actor=<NIK>
//   npx tsx scripts/fix-petty-cash-oct-nov-periods.ts --restore=backups/<file>.json --confirm=<db>   # undo an --apply
//
// Safety: reads DATABASE_URL (.env.local) and prints which database that is first. Applying needs the database name
// typed back (--confirm=…) and, on production (anything that is not a *-staging / local database, or that equals
// PRODUCTION_DATABASE_URL), ALLOW_PRODUCTION_DB=1 as well. Everything runs in ONE transaction that locks the stores'
// periods, requests and refills, writes a JSON backup of every row it will change BEFORE changing it (backups/,
// git-ignored), re-checks the result and rolls back if any check fails. A store that is not in the shape this script
// expects (a verified or received refill, an extra period, a request outside Sep–Nov, > 1 live refill request) is
// SKIPPED and listed, never guessed at. Receipt photos and the legacy petty_cash_refills table are not touched.

import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: '.env' });

import fs from 'node:fs';
import path from 'node:path';
import { Pool, type PoolClient } from 'pg';
import { describeTarget, sameDatabase } from './lib/db-target';
import { jakartaTodayKey } from '@/lib/day-bucket';
import { usagePeriodFor } from '@/lib/petty-cash-period';
import { LEFT_OUT_REVIEWS } from '@/lib/petty-cash-review';

// ─── Settings ────────────────────────────────────────────────────────────────

const OLD = '2026-10'; // 16 Sep – 15 Oct
const NEW = '2026-11'; // 16 Oct – 15 Nov
const MAX = 1_000_000;

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);

const APPLY = flag('apply');
const VERIFY = flag('verify');
const NOTIFY = !flag('no-notify');
const ACTOR_NIK = opt('actor');
const CONFIRM = opt('confirm');
const RESTORE = opt('restore');
const BUCKET = (opt('bucket') ?? 'confirmed') as 'confirmed' | 'filed';
const ONLY = opt('store')?.split(',').map((s) => s.trim()).filter(Boolean);
const INCLUDE_DUMMY = flag('include-dummy'); // tests only: lets --store=DUMMY-001 through

const line = () => console.log('─'.repeat(96));
const die = (msg: string): never => {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
};
const rp = (n: number) => `Rp ${Math.round(n).toLocaleString('id-ID')}`;
const num = (v: unknown) => (v == null ? 0 : Number(v));

if (BUCKET !== 'confirmed' && BUCKET !== 'filed') die('--bucket must be "confirmed" or "filed".');
if (INCLUDE_DUMMY && !ONLY) die('--include-dummy only works together with --store=<DUMMY store>.');
if (VERIFY && !ACTOR_NIK) die('--verify needs --actor=<NIK of the Finance/IT user the verification is recorded under>.');

// ─── Day helpers (timestamps are "timestamp without time zone") ─────────────

// Explicit `new Date()` writes (created_at …) are stored as the UTC wall clock; SQL `NOW()` writes (the confirm of
// a request, `actual_amount_at`) as the Jakarta wall clock, which is the session zone. The second kind always has
// microseconds (≥ 4 fractional digits once trailing zeros are trimmed); anything shorter is read as a UTC instant.
const parseWall = (s: string) => new Date(`${s.replace(' ', 'T')}${/[zZ]|[+-]\d\d(:?\d\d)?$/.test(s) ? '' : 'Z'}`);
const dayOf = (d: Date) => d.toISOString().slice(0, 10);
const filedDay = (createdAt: string) => dayOf(new Date(parseWall(createdAt).getTime() + 7 * 3_600_000));
function confirmedDay(actualAt: string | null, createdAt: string): { day: string; ambiguous: boolean } {
  if (!actualAt) return { day: filedDay(createdAt), ambiguous: true };
  const frac = actualAt.match(/\.(\d+)$/)?.[1].length ?? 0;
  return frac >= 4
    ? { day: dayOf(parseWall(actualAt)), ambiguous: false }
    : { day: filedDay(actualAt), ambiguous: true };
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface PeriodRow {
  id: number;
  store_id: number;
  year_month: string;
  status: string;
  current_balance: string;
  opening_balance: string;
  closing_balance: string | null;
  closed_at: string | null;
  updated_at: string | null;
  [k: string]: unknown;
}
interface TxRow {
  id: number;
  store_id: number;
  period_id: number | null;
  year_month: string;
  status: string;
  finance_review: string | null;
  is_re_request: boolean;
  amount: string;
  actual_amount: string | null;
  created_at: string;
  actual_amount_at: string | null;
  updated_at: string | null;
}
interface RefillRow {
  id: number;
  store_id: number;
  year_month: string;
  status: string;
  requested_by: string;
  balance_before: string | null;
  balance_after: string | null;
  finance_verified_at: string | null;
  transfer_amount: string | null;
  drawer_photo_url: string | null;
  signature_photo_url: string | null;
  [k: string]: unknown;
}
interface StoreRow {
  id: number;
  store_no: string;
  name: string;
}

interface Plan {
  store: StoreRow;
  skip: string | null;
  notes: string[];
  usedOld: number;
  usedNew: number;
  balOldNow: number | null;
  balNewNow: number | null;
  balOld: number;
  balNew: number;
  oldPeriod: PeriodRow | null;
  newPeriod: PeriodRow | null;
  moves: { id: number; to: string; from: string; amount: number; status: string }[];
  pendingMoves: number;
  refill: {
    id: number;
    fromLabel: string;
    toLabel: string;
    balanceBefore: number;
    transfer: number;
    rejectedCount: number;
    rejectedAmount: number;
    requestedBy: string;
    verified: boolean;
  } | null;
  drift: string[];
}

const leftOut = (r: string | null) => r != null && (LEFT_OUT_REVIEWS as readonly string[]).includes(r);
const amountOf = (t: TxRow) => num(t.actual_amount ?? t.amount);
const countsAsUsed = (t: TxRow) => t.status === 'completed' && !leftOut(t.finance_review);

// ─── Restore mode ────────────────────────────────────────────────────────────

async function restore(pool: Pool, file: string, dbName: string) {
  const backup = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (backup.database !== dbName) die(`That backup is of database "${backup.database}", this one is "${dbName}".`);
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    for (const t of backup.transactions as TxRow[]) {
      await c.query(`update petty_cash_transactions set period_id=$2, year_month=$3, updated_at=$4 where id=$1`, [
        t.id, t.period_id, t.year_month, t.updated_at,
      ]);
    }
    for (const r of backup.refillRequests as RefillRow[]) {
      await c.query(
        `update petty_cash_refill_requests set year_month=$2, balance_before=$3, finance_verified_by=$4, finance_verified_at=$5,
                transfer_amount=$6, rejected_count=$7, rejected_amount=$8, updated_at=$9 where id=$1`,
        [r.id, r.year_month, r.balance_before, r.finance_verified_by, r.finance_verified_at, r.transfer_amount, r.rejected_count, r.rejected_amount, r.updated_at],
      );
    }
    for (const p of backup.periods as PeriodRow[]) {
      await c.query(
        `update petty_cash_periods set status=$2, current_balance=$3, closed_at=$4, updated_at=$5 where id=$1`,
        [p.id, p.status, p.current_balance, p.closed_at, p.updated_at],
      );
    }
    const created: number[] = backup.applied?.createdPeriodIds ?? [];
    if (created.length) await c.query(`delete from petty_cash_periods where id = any($1::int[])`, [created]);
    const notifs: number[] = backup.applied?.notificationIds ?? [];
    if (notifs.length) await c.query(`delete from notifications where id = any($1::int[])`, [notifs]);
    await c.query('COMMIT');
    console.log(`✅ restored ${backup.periods.length} periods (${created.length} created ones removed), ${backup.transactions.length} requests, ${backup.refillRequests.length} refill requests, ${notifs.length} notifications removed.`);
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) die('DATABASE_URL is not set.');
  const pool = new Pool({ connectionString: url as string, connectionTimeoutMillis: 10_000, max: 2 });

  try {
    const { rows: [{ db: dbName }] } = await pool.query(`select current_database() db`);
    const prodUrl = process.env.PRODUCTION_DATABASE_URL;
    const isProd =
      process.env.NODE_ENV === 'production' ||
      (!!prodUrl && sameDatabase(url as string, prodUrl)) ||
      !(/-staging$/.test(dbName) || /^prism_local$/.test(dbName));

    console.log(RESTORE ? '♻️  RESTORE from a backup' : APPLY ? '🛠  APPLY' : '🔍 DRY RUN — read-only, nothing is changed');
    line();
    console.log(`database : ${describeTarget(url as string)}  (current_database() = ${dbName})${isProd ? '   ⚠ PRODUCTION' : ''}`);
    console.log(`bucket   : ${BUCKET === 'confirmed' ? 'day the amount was confirmed (actual_amount_at)' : 'day the request was filed (created_at)'}`);
    line();

    if ((APPLY || RESTORE) && CONFIRM !== dbName) die(`Applying needs the database name typed back: --confirm=${dbName}`);
    if ((APPLY || RESTORE) && isProd && process.env.ALLOW_PRODUCTION_DB !== '1') {
      die(`"${dbName}" is a PRODUCTION database. Re-run with ALLOW_PRODUCTION_DB=1 only if the owner of the data said so.`);
    }
    if (RESTORE) return await restore(pool, RESTORE, dbName);

    const today = jakartaTodayKey();
    if (usagePeriodFor(today) !== NEW) die(`Today (${today}) is no longer in the ${NEW} period — this script is only for the Oct → Nov switch.`);

    const c: PoolClient = await pool.connect();
    try {
      await c.query(APPLY ? 'BEGIN' : 'BEGIN READ ONLY');
      const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
        (await c.query(sql, params)).rows as T[];

      // ── Actor for --verify ────────────────────────────────────────────────
      let actor: { id: string; name: string } | null = null;
      if (VERIFY) {
        const [u] = await q<{ id: string; name: string; role: string }>(
          `select u.id, u.name, r.code role from users u join user_roles r on r.id = u.role_id where u.nik = $1 and u.is_active`,
          [ACTOR_NIK],
        );
        if (!u) die(`No active user with NIK ${ACTOR_NIK}.`);
        if (!['finance', 'it'].includes(u.role)) die(`${ACTOR_NIK} is a "${u.role}" user — verification must be recorded under a Finance or IT user.`);
        actor = { id: u.id, name: u.name };
      }

      // ── Stores in scope ───────────────────────────────────────────────────
      const stores = await q<StoreRow>(
        `select id, store_no, name from stores
          where status = 'active' ${INCLUDE_DUMMY ? '' : `and store_no not like 'DUMMY%'`} ${ONLY ? 'and store_no = any($1::text[])' : ''}
          order by store_no`,
        ONLY ? [ONLY] : [],
      );
      if (ONLY) {
        const missing = ONLY.filter((s) => !stores.some((x) => x.store_no === s));
        if (missing.length) die(`Not found / not active / DUMMY: ${missing.join(', ')}`);
      }
      const ids = stores.map((s) => s.id);

      // Lock everything we are about to read-then-write (apply only; a read-only tx cannot lock).
      const lock = APPLY ? ' for update' : '';
      const periods = await q<PeriodRow>(
        `select id, store_id, year_month, status, current_balance::text, opening_balance::text, closing_balance::text,
                closed_at::text, updated_at::text from petty_cash_periods where store_id = any($1::int[]) order by store_id, year_month${lock}`,
        [ids],
      );
      const txs = await q<TxRow>(
        `select id, store_id, period_id, year_month, status, finance_review, is_re_request, amount::text, actual_amount::text,
                created_at::text, actual_amount_at::text, updated_at::text
           from petty_cash_transactions where store_id = any($1::int[]) order by store_id, id${lock}`,
        [ids],
      );
      const refills = await q<RefillRow>(
        `select id, store_id, year_month, status, requested_by, balance_before::text, balance_after::text, finance_verified_by,
                finance_verified_at::text, transfer_amount::text, rejected_count, rejected_amount::text, drawer_photo_url,
                signature_photo_url, updated_at::text
           from petty_cash_refill_requests where store_id = any($1::int[]) order by store_id, id${lock}`,
        [ids],
      );
      const monthEnd = await q<{ store_id: number }>(`select store_id from petty_cash_refills where store_id = any($1::int[])`, [ids]);
      const [{ n: txBefore }] = await q<{ n: number }>(`select count(*)::int n from petty_cash_transactions`);
      const [{ n: refillBefore }] = await q<{ n: number }>(`select count(*)::int n from petty_cash_refill_requests`);

      const plans: Plan[] = [];

      for (const store of stores) {
        const p = periods.filter((x) => x.store_id === store.id);
        const t = txs.filter((x) => x.store_id === store.id);
        const r = refills.filter((x) => x.store_id === store.id);
        const oldPeriod = p.find((x) => x.year_month === OLD) ?? null;
        const newPeriod = p.find((x) => x.year_month === NEW) ?? null;

        const plan: Plan = {
          store, skip: null, notes: [], usedOld: 0, usedNew: 0,
          balOldNow: oldPeriod ? num(oldPeriod.current_balance) : null,
          balNewNow: newPeriod ? num(newPeriod.current_balance) : null,
          balOld: MAX, balNew: MAX, oldPeriod, newPeriod, moves: [], pendingMoves: 0, refill: null, drift: [],
        };
        plans.push(plan);

        // ── Shapes this script does not handle → skip, never guess ──
        const otherPeriods = p.filter((x) => x.year_month !== OLD && x.year_month !== NEW);
        if (otherPeriods.length) plan.skip = `has other periods (${otherPeriods.map((x) => x.year_month).join(', ')})`;
        else if (!oldPeriod && !newPeriod) plan.skip = 'has no October/November period';
        else if (newPeriod && newPeriod.status === 'closed') plan.skip = 'November period is already closed';
        else if (t.some((x) => x.year_month !== OLD && x.year_month !== NEW)) plan.skip = 'has requests outside Oct/Nov';
        else if (t.some((x) => x.is_re_request)) plan.skip = 'has a Re-request';
        else if (monthEnd.some((x) => x.store_id === store.id)) plan.skip = 'has a legacy month-end refill';
        else if (r.some((x) => x.finance_verified_at || x.balance_after)) plan.skip = 'has a refill that Finance already verified / PIC 1 received';
        const live = r.filter((x) => x.status !== 'rejected');
        if (!plan.skip && live.length > 1) plan.skip = `has ${live.length} live refill requests`;
        if (!plan.skip && live[0] && !['pending', 'approved'].includes(live[0].status)) plan.skip = 'has a refill request in an unexpected state';
        if (!plan.skip && live[0] && live[0].year_month !== OLD && live[0].year_month !== NEW) plan.skip = `refill request is labelled ${live[0].year_month}`;

        // drift of today's rows (does each period's balance equal Rp 1.000.000 − what its own requests used?)
        for (const per of p) {
          const used = t.filter((x) => x.year_month === per.year_month && countsAsUsed(x)).reduce((s, x) => s + amountOf(x), 0);
          if (Math.round(num(per.current_balance)) !== Math.max(0, MAX - used)) {
            plan.drift.push(`${per.year_month}: balance ${rp(num(per.current_balance))} but requests say ${rp(MAX - used)}`);
          }
        }
        if (plan.skip) continue;

        // ── Where does every request belong? ──
        for (const x of t) {
          let to = x.year_month;
          if (x.status === 'completed') {
            const when = BUCKET === 'confirmed' ? confirmedDay(x.actual_amount_at, x.created_at) : { day: filedDay(x.created_at), ambiguous: false };
            if (when.ambiguous) plan.notes.push(`request #${x.id}: confirm time unclear — read it as a UTC instant`);
            to = usagePeriodFor(when.day);
            if (to !== OLD && to !== NEW) {
              plan.skip = `request #${x.id} falls in ${to}`;
              break;
            }
          } else if (x.status === 'pending_ops' || x.status === 'ops_approved') {
            to = NEW;
          }
          if (to !== x.year_month) {
            plan.moves.push({ id: x.id, to, from: x.year_month, amount: amountOf(x), status: x.status });
            if (x.status !== 'completed') plan.pendingMoves++;
          }
          if (countsAsUsed(x)) {
            if (to === OLD) plan.usedOld += amountOf(x);
            else plan.usedNew += amountOf(x);
          }
        }
        if (plan.skip) continue;

        plan.balOld = Math.max(0, MAX - plan.usedOld);
        plan.balNew = Math.max(0, MAX - plan.usedNew); // Oct → Nov carries nothing (carry starts with the 2026-11 period)
        if (plan.usedOld > MAX) plan.notes.push(`October used ${rp(plan.usedOld)} — more than Rp 1.000.000, balance clamped to 0`);
        if (plan.usedNew > MAX) plan.notes.push(`November used ${rp(plan.usedNew)} — more than Rp 1.000.000, balance clamped to 0`);

        // ── Its open refill request: which period does it pay? ──
        const req = live[0];
        if (req) {
          const toLabel = plan.usedOld > 0 ? OLD : plan.usedNew > 0 ? NEW : req.year_month;
          const bal = toLabel === OLD ? plan.balOld : plan.balNew;
          const target = txsInPeriod(t, plan, toLabel);
          plan.refill = {
            id: req.id, fromLabel: req.year_month, toLabel, balanceBefore: bal,
            transfer: Math.max(0, MAX - bal),
            rejectedCount: target.filter((x) => leftOut(x.finance_review)).length,
            rejectedAmount: target.filter((x) => leftOut(x.finance_review)).reduce((s, x) => s + amountOf(x), 0),
            requestedBy: req.requested_by,
            verified: false,
          };
          if (plan.usedOld === 0 && plan.usedNew === 0) plan.notes.push(`refill #${req.id} has nothing to pay (no usage)`);
        } else if (plan.usedOld > 0) {
          plan.notes.push(`October used ${rp(plan.usedOld)} but NO refill request exists — PIC 1 has to send it in the app`);
        }
      }

      // ── Print the plan ─────────────────────────────────────────────────────
      const ok = plans.filter((x) => !x.skip);
      const skipped = plans.filter((x) => x.skip);
      console.log(`stores in scope ${plans.length} · to fix ${ok.length} · skipped ${skipped.length}`);
      line();
      console.log('store      Oct now → fix                     Nov now → fix                     moved  refill request');
      for (const x of ok) {
        const o = `${x.balOldNow == null ? '—' : rp(x.balOldNow)} → ${rp(x.balOld)} (${x.oldPeriod?.status ?? '—'}→closed)`;
        const n = `${x.balNewNow == null ? 'new' : rp(x.balNewNow)} → ${rp(x.balNew)} (${x.newPeriod?.status ?? 'new'}→open)`;
        const rf = x.refill
          ? `#${x.refill.id} ${x.refill.fromLabel}${x.refill.fromLabel === x.refill.toLabel ? '' : ` → ${x.refill.toLabel}`}  transfer ${rp(x.refill.transfer)}`
          : '—';
        console.log(`${x.store.store_no.padEnd(8)}  ${o.padEnd(40)}${n.padEnd(40)}${String(x.moves.length).padStart(4)}   ${rf}`);
        for (const note of x.notes) console.log(`            · ${note}`);
        for (const d of x.drift) console.log(`            ⚠ drift before fix — ${d}`);
      }
      for (const x of skipped) console.log(`SKIPPED ${x.store.store_no}: ${x.skip}`);
      line();
      const withRefill = ok.filter((x) => x.refill);
      console.log(`requests re-sorted: ${ok.reduce((s, x) => s + x.moves.length, 0)} (${ok.reduce((s, x) => s + x.pendingMoves, 0)} of them still waiting → ${NEW})`);
      console.log(`refill requests relabelled: ${withRefill.filter((x) => x.refill!.fromLabel !== x.refill!.toLabel).length} of ${withRefill.length}`);
      console.log(`to transfer if all are verified: ${rp(withRefill.reduce((s, x) => s + x.refill!.transfer, 0))} in ${withRefill.length} refills (Oct ${rp(withRefill.filter((x) => x.refill!.toLabel === OLD).reduce((s, x) => s + x.refill!.transfer, 0))} · Nov ${rp(withRefill.filter((x) => x.refill!.toLabel === NEW).reduce((s, x) => s + x.refill!.transfer, 0))})`);
      if (VERIFY) console.log(`verification would be recorded under: ${actor!.name} (${ACTOR_NIK})${NOTIFY ? ', PIC 1 notified' : ', no notification'}`);

      const planFile = path.resolve('backups', `petty-cash-oct-nov-plan-${dbName}-${today}.json`);
      fs.mkdirSync(path.dirname(planFile), { recursive: true });
      fs.writeFileSync(planFile, JSON.stringify({ database: dbName, today, bucket: BUCKET, plans: plans.map((x) => ({ ...x, oldPeriod: undefined, newPeriod: undefined })) }, null, 2));
      console.log(`plan written to ${path.relative(process.cwd(), planFile)}`);

      if (!APPLY) {
        await c.query('ROLLBACK');
        console.log('\n🔍 dry run — nothing changed. Add --apply --confirm=' + dbName + ' to write it.');
        return;
      }

      // ── Backup BEFORE any write ───────────────────────────────────────────
      const touchedStoreIds = new Set(ok.map((x) => x.store.id));
      const movedIds = new Set(ok.flatMap((x) => x.moves.map((m) => m.id)));
      const refillIds = new Set(ok.flatMap((x) => (x.refill ? [x.refill.id] : [])));
      const backup = {
        database: dbName, takenAt: new Date().toISOString(), bucket: BUCKET,
        periods: periods.filter((x) => touchedStoreIds.has(x.store_id)),
        transactions: txs.filter((x) => movedIds.has(x.id)).map((x) => ({ id: x.id, period_id: x.period_id, year_month: x.year_month, updated_at: x.updated_at })),
        refillRequests: refills.filter((x) => refillIds.has(x.id)),
        applied: { createdPeriodIds: [] as number[], notificationIds: [] as number[] },
      };
      const backupFile = path.resolve('backups', `petty-cash-oct-nov-backup-${dbName}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
      fs.writeFileSync(backupFile, JSON.stringify(backup, null, 2));
      console.log(`backup written to ${path.relative(process.cwd(), backupFile)}`);

      // ── Write ─────────────────────────────────────────────────────────────
      const utcNow = `(now() at time zone 'utc')`;
      for (const x of ok) {
        const sid = x.store.id;
        if (x.oldPeriod) {
          await c.query(
            `update petty_cash_periods set current_balance=$2, status='closed', closed_at=coalesce(closed_at, ${utcNow}), updated_at=${utcNow} where id=$1`,
            [x.oldPeriod.id, x.balOld.toFixed(2)],
          );
        }
        const ins = await c.query(
          `insert into petty_cash_periods (store_id, year_month, opening_balance, current_balance, status, created_at, updated_at)
             values ($1, $2, $3, $4, 'open', ${utcNow}, ${utcNow})
             on conflict (store_id, year_month) do update set current_balance=excluded.current_balance, status='open', closed_at=null, updated_at=${utcNow}
             returning id, (xmax = 0) as inserted`,
          [sid, NEW, MAX.toFixed(2), x.balNew.toFixed(2)],
        );
        const newId: number = ins.rows[0].id;
        if (ins.rows[0].inserted) backup.applied.createdPeriodIds.push(newId);
        const oldId = x.oldPeriod?.id ?? null;

        for (const [ym, pid] of [[OLD, oldId], [NEW, newId]] as const) {
          const mv = x.moves.filter((m) => m.to === ym).map((m) => m.id);
          if (mv.length && pid != null) {
            await c.query(`update petty_cash_transactions set period_id=$2, year_month=$3, updated_at=${utcNow} where id = any($1::int[])`, [mv, pid, ym]);
          } else if (mv.length) {
            throw new Error(`${x.store.store_no}: ${mv.length} requests belong to ${ym} but the store has no such period`);
          }
        }

        if (x.refill) {
          const rf = x.refill;
          await c.query(
            `update petty_cash_refill_requests set year_month=$2, balance_before=$3, updated_at=${utcNow} where id=$1`,
            [rf.id, rf.toLabel, rf.balanceBefore.toFixed(2)],
          );
          if (VERIFY && rf.transfer > 0) {
            const upd = await c.query(
              `update petty_cash_refill_requests
                  set finance_verified_by=$2, finance_verified_at=${utcNow}, transfer_amount=$3, rejected_count=$4, rejected_amount=$5
                where id=$1 and status='approved' and finance_verified_at is null returning id`,
              [rf.id, actor!.id, rf.transfer.toFixed(2), rf.rejectedCount, rf.rejectedAmount.toFixed(2)],
            );
            rf.verified = upd.rowCount === 1;
            if (rf.verified && NOTIFY) {
              const n = await c.query(
                `insert into notifications (user_id, type, title, body, link, related_type, related_id, created_at)
                 values ($1, 'petty_cash_refill_verified', 'Refill petty cash sudah diproses Finance', $2, '/employee/pettycash',
                         'petty_cash_refill_request', $3, ${utcNow}) returning id`,
                [
                  rf.requestedBy,
                  `Finance sudah memverifikasi Refill toko kamu: ${rp(rf.transfer)} ditransfer. Setelah uangnya diterima, unggah foto laci petty cash dan Surat Terima.`,
                  rf.id,
                ],
              );
              backup.applied.notificationIds.push(n.rows[0].id);
            }
          }
        }
      }

      // ── Re-check, inside the same transaction ─────────────────────────────
      const problems: string[] = [];
      const afterPeriods = await q<PeriodRow>(`select id, store_id, year_month, status, current_balance::text from petty_cash_periods where store_id = any($1::int[])`, [[...touchedStoreIds]]);
      const afterTxs = await q<TxRow>(
        `select t.id, t.store_id, t.period_id, t.year_month, t.status, t.finance_review, t.is_re_request, t.amount::text, t.actual_amount::text, t.created_at::text, t.actual_amount_at::text
           from petty_cash_transactions t where t.store_id = any($1::int[])`,
        [[...touchedStoreIds]],
      );
      const afterRefills = await q<RefillRow>(`select id, store_id, year_month, status, balance_before::text, finance_verified_at::text, transfer_amount::text, balance_after::text from petty_cash_refill_requests where store_id = any($1::int[])`, [[...touchedStoreIds]]);
      for (const x of ok) {
        const per = (ym: string) => afterPeriods.find((p) => p.store_id === x.store.id && p.year_month === ym);
        const o = per(OLD);
        const n = per(NEW);
        if (x.oldPeriod && (!o || o.status !== 'closed' || Math.round(num(o.current_balance)) !== Math.round(x.balOld))) problems.push(`${x.store.store_no}: October row wrong`);
        if (!n || n.status !== 'open' || Math.round(num(n.current_balance)) !== Math.round(x.balNew)) problems.push(`${x.store.store_no}: November row wrong`);
        for (const t of afterTxs.filter((y) => y.store_id === x.store.id)) {
          const owner = afterPeriods.find((p) => p.id === t.period_id);
          if (!owner || owner.year_month !== t.year_month) problems.push(`${x.store.store_no}: request #${t.id} points at a period of another month`);
        }
        for (const [ym, used] of [[OLD, x.usedOld], [NEW, x.usedNew]] as const) {
          const sum = afterTxs
            .filter((y) => y.store_id === x.store.id && y.year_month === ym && countsAsUsed(y))
            .reduce((s, y) => s + amountOf(y), 0);
          if (Math.round(sum) !== Math.round(used)) problems.push(`${x.store.store_no}: ${ym} usage ${rp(sum)} ≠ planned ${rp(used)}`);
          const bal = per(ym);
          if (bal && Math.round(num(bal.current_balance)) !== Math.max(0, MAX - Math.round(sum))) problems.push(`${x.store.store_no}: ${ym} balance ≠ Rp 1.000.000 − usage`);
        }
        if (x.refill) {
          const rr = afterRefills.find((y) => y.id === x.refill!.id);
          if (!rr || rr.year_month !== x.refill.toLabel) problems.push(`${x.store.store_no}: refill #${x.refill.id} label wrong`);
          if (rr?.balance_after) problems.push(`${x.store.store_no}: refill #${x.refill.id} got a balance_after — this script must never receive`);
          if (VERIFY && x.refill.transfer > 0 && Math.round(num(rr?.transfer_amount)) !== Math.round(x.refill.transfer)) problems.push(`${x.store.store_no}: refill #${x.refill.id} transfer wrong`);
        }
      }
      // no request or refill request may appear or vanish
      const [{ n: txAfter }] = await q<{ n: number }>(`select count(*)::int n from petty_cash_transactions`);
      const [{ n: refillAfter }] = await q<{ n: number }>(`select count(*)::int n from petty_cash_refill_requests`);
      if (txAfter !== txBefore) problems.push('petty_cash_transactions row count changed');
      if (refillAfter !== refillBefore) problems.push('petty_cash_refill_requests row count changed');

      if (problems.length) {
        await c.query('ROLLBACK');
        console.error('\n❌ re-check failed, ROLLED BACK — nothing was changed:\n  - ' + problems.join('\n  - '));
        process.exit(1);
      }
      await c.query('COMMIT');
      fs.writeFileSync(backupFile, JSON.stringify(backup, null, 2)); // now with the ids it created
      console.log(`\n✅ done in one transaction — ${ok.length} stores fixed, ${backup.applied.createdPeriodIds.length} November periods created, ${backup.applied.notificationIds.length} notifications sent.`);
      console.log(`   undo: npx tsx scripts/fix-petty-cash-oct-nov-periods.ts --restore=${path.relative(process.cwd(), backupFile)} --confirm=${dbName}`);
    } finally {
      c.release();
    }
  } finally {
    await pool.end();
  }
}

/** The completed + waiting requests that end up in `ym` once the plan is applied (for the refill's rejected figures). */
function txsInPeriod(all: TxRow[], plan: Plan, ym: string): TxRow[] {
  const moved = new Map(plan.moves.map((m) => [m.id, m.to]));
  return all.filter((x) => x.status === 'completed' && (moved.get(x.id) ?? x.year_month) === ym);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
