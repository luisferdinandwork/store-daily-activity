// scripts/seed/training-roster-reset.ts
// ─────────────────────────────────────────────────────────────────────────────
// PIC 1 training (23 Sep 2026) reset: wipe schedule/activity/targets for every
// store except FF001 + FO001, then load the HR roster sheet as user accounts.
//
//   npx dotenv -e .env.local -- tsx scripts/seed/training-roster-reset.ts "<roster.xlsx>"            # preview only
//   APPLY=1 npx dotenv -e .env.local -- tsx scripts/seed/training-roster-reset.ts "<roster.xlsx>"    # write
//
// 1. Wipe (stores other than FF001/FO001): schedules, monthly schedules,
//    attendance + breaks + cash counts, every task table, setoran ledger,
//    serah-terima board and the monthly performance targets. Child rows are
//    found through the live FK catalog and removed first; a child table outside
//    the wipe list is never deleted from — its FK column is nulled if nullable,
//    otherwise the script aborts before writing anything.
//    Users, stores, areas, issues, visits, reports and BC item-transfer orders
//    are untouched.
// 2. Users — the sheet goes through the IT Users importer (lib/user-import.ts),
//    minus: FF001/FO001 rows, rows without a real NIK ("", "-", "BLM PUNYA NIK"),
//    rows without a LEVEL (e.g. a rotation note row) and NIKs that appear on two
//    different people. New users get password123; unknown stores are created.
//    The sheet's "ODD010" is imported as OD010 (STORE_CODE_FIX).
// Schedules and targets are left empty afterwards.
// ─────────────────────────────────────────────────────────────────────────────

import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: '.env' });

import { readFileSync } from 'node:fs';
import { eq, inArray, notInArray, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import { stores, users } from '@/lib/db/schema';
import { buildUserImportReport, loadUserImportLookups, parseUsersWorkbook, type RawUserImportRow } from '@/lib/user-import';

const APPLY = process.env.APPLY === '1';
const KEEP_STORES = ['FF001', 'FO001'];

/** Tables whose rows for the wiped stores are removed. Each has a store_id column (checked at runtime). */
const WIPE_TABLES = [
  'store_monthly_targets', 'employee_monthly_targets',
  'serah_terima_entries', 'setoran_money_storage', 'store_cash_counts',
  'store_opening_tasks', 'store_front_tasks', 'setoran_tasks', 'cek_bin_tasks', 'vm_checklist_tasks',
  'item_dropping_tasks', 'item_return_tasks', 'cek_uang_modal_tasks', 'marketing_check_tasks', 'briefing_tasks',
  'serah_terima_tasks', 'store_closing_tasks', 'grooming_tasks',
  'break_sessions', 'attendance', 'schedules', 'monthly_schedule_entries', 'monthly_schedules',
];
/** Children of wiped rows that may be deleted along with their parent (no store_id of their own, or reached via FK). */
const CHILD_OK = new Set([...WIPE_TABLES, 'cek_uang_modal_denominations', 'cek_bin_task_bins', 'item_dropping_entries', 'item_return_entries']);

interface Fk { child: string; column: string; parent: string; nullable: boolean; onDelete: string }

async function loadFks(): Promise<Fk[]> {
  const res = await db.execute(sql`
    select c.conrelid::regclass::text as child, a.attname as column, c.confrelid::regclass::text as parent,
           not a.attnotnull as nullable, c.confdeltype as on_delete
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and c.connamespace = 'public'::regnamespace`);
  return (res.rows as Array<{ child: string; column: string; parent: string; nullable: boolean; on_delete: string }>)
    .map((r) => ({ child: r.child.replace(/"/g, ''), column: r.column, parent: r.parent.replace(/"/g, ''), nullable: r.nullable, onDelete: r.on_delete }));
}

async function tableColumns(table: string): Promise<Set<string>> {
  const res = await db.execute(sql`select column_name from information_schema.columns where table_schema = 'public' and table_name = ${table}`);
  return new Set((res.rows as Array<{ column_name: string }>).map((r) => r.column_name));
}

// ─── 1. wipe ─────────────────────────────────────────────────────────────────

async function wipe(storeIds: number[]) {
  const fks = await loadFks();
  const ids = sql.join(storeIds.map((id) => sql`${id}`), sql`, `);

  // Plan: every WIPE_TABLES row with store_id in the set, plus FK descendants.
  const counts: Record<string, number> = {};
  const nullOuts: Array<{ table: string; column: string; parent: string }> = [];
  const problems: string[] = [];
  const visit = async (table: string, depth: number) => {
    if (depth > 6) return;
    for (const fk of fks.filter((f) => f.parent === table && f.child !== table)) {
      if (fk.onDelete === 'c' || fk.onDelete === 'n') continue; // cascade / set null — Postgres handles it
      if (CHILD_OK.has(fk.child)) { await visit(fk.child, depth + 1); continue; }
      if (fk.nullable) nullOuts.push({ table: fk.child, column: fk.column, parent: table });
      else problems.push(`${fk.child}.${fk.column} → ${table} is NOT NULL and outside the wipe list`);
    }
  };
  for (const t of WIPE_TABLES) {
    const cols = await tableColumns(t);
    if (cols.size === 0) { console.log(`   (table ${t} does not exist — skipped)`); continue; }
    if (!cols.has('store_id')) { problems.push(`${t} has no store_id column`); continue; }
    const res = await db.execute(sql`select count(*)::int as n from ${sql.identifier(t)} where store_id in (${ids})`);
    counts[t] = (res.rows[0] as { n: number }).n;
    await visit(t, 0);
  }

  console.log('\n   rows to delete (stores other than FF001/FO001):');
  for (const [t, n] of Object.entries(counts)) if (n > 0) console.log(`     ${t.padEnd(28)} ${n}`);
  if (Object.values(counts).every((n) => n === 0)) console.log('     (nothing — already empty)');
  const uniqNullOuts = [...new Map(nullOuts.map((n) => [`${n.table}.${n.column}`, n])).values()];
  if (uniqNullOuts.length) console.log(`   references to be nulled: ${uniqNullOuts.map((n) => `${n.table}.${n.column}`).join(', ')}`);
  if (problems.length) throw new Error(`Cannot wipe safely:\n     - ${problems.join('\n     - ')}`);
  if (!APPLY) return;

  // Delete children before parents: a table goes once nothing outside CHILD_OK
  // still points at it. Simple approach — repeat deletes in list order, deepest
  // FK children (denominations/bins/entries) first by id join.
  for (const n of uniqNullOuts) {
    await db.execute(sql`update ${sql.identifier(n.table)} set ${sql.identifier(n.column)} = null
      where ${sql.identifier(n.column)} in (select id from ${sql.identifier(n.parent)} where store_id in (${ids}))`);
  }
  const deleteChildren = async (table: string, depth: number) => {
    if (depth > 6) return;
    for (const fk of fks.filter((f) => f.parent === table && f.child !== table && CHILD_OK.has(f.child) && f.onDelete !== 'c' && f.onDelete !== 'n')) {
      await deleteChildren(fk.child, depth + 1);
      await db.execute(sql`delete from ${sql.identifier(fk.child)}
        where ${sql.identifier(fk.column)} in (select id from ${sql.identifier(table)} where store_id in (${ids}))`);
    }
  };
  for (const t of WIPE_TABLES) {
    if (!(t in counts)) continue;
    await deleteChildren(t, 0);
    await db.execute(sql`delete from ${sql.identifier(t)} where store_id in (${ids})`);
  }
  console.log('   ✓ wiped');
}

// ─── 2. users ────────────────────────────────────────────────────────────────

/** Store codes the HR sheet spells differently from the BC/POS code. */
const STORE_CODE_FIX: Record<string, string> = { ODD010: 'OD010' };

function filterRows(rows: RawUserImportRow[]) {
  const skipped: string[] = [];
  for (const r of rows) {
    const fixed = STORE_CODE_FIX[r.storeNo.trim().toUpperCase()];
    if (fixed) r.storeNo = fixed;
  }
  const validNik = (n: string) => /^A\d{6,}$/i.test(n.trim());
  const namesByNik = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!validNik(r.nik)) continue;
    const k = r.nik.trim().toUpperCase();
    namesByNik.set(k, (namesByNik.get(k) ?? new Set()).add(r.name.trim().toLowerCase()));
  }
  const kept = rows.filter((r) => {
    const tag = `row ${r.excelRow} ${r.storeNo} ${r.nik || '(no NIK)'} ${r.name}`;
    if (KEEP_STORES.includes(r.storeNo.trim().toUpperCase())) { skipped.push(`${tag} — FF001/FO001 untouched`); return false; }
    if (!validNik(r.nik)) { skipped.push(`${tag} — no NIK`); return false; }
    if (!r.level.trim() || r.level.trim() === '-') { skipped.push(`${tag} — no LEVEL (${r.active || 'no status'})`); return false; }
    if ((namesByNik.get(r.nik.trim().toUpperCase())?.size ?? 0) > 1) { skipped.push(`${tag} — NIK shared by two different people`); return false; }
    return true;
  });
  return { kept, skipped };
}

async function importUsers(file: string) {
  const buf = readFileSync(file);
  const parsed = parseUsersWorkbook(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
  if ('headerError' in parsed) throw new Error(parsed.headerError);
  const { kept, skipped } = filterRows(parsed.rows);
  console.log(`\n   sheet "${parsed.sheetName}": ${parsed.rows.length} rows → ${kept.length} to import, ${skipped.length} skipped`);
  for (const s of skipped) console.log(`     skip ${s}`);

  const [it] = await db.select({ id: users.id }).from(users).where(eq(users.nik, 'IT-001')).limit(1);
  const report = await buildUserImportReport(kept, await loadUserImportLookups(), { commit: APPLY, assignedBy: it?.id ?? (null as unknown as string) });

  console.log(`   users: ${report.toCreate} new, ${report.toUpdate} updated, ${report.unchanged} unchanged, ${report.invalid} invalid`);
  if (report.newAreas.length) console.log(`   new areas: ${report.newAreas.join(', ')}`);
  if (report.newStores.length) console.log(`   new stores: ${report.newStores.map((s) => `${s.storeNo} (${s.name})`).join(', ')}`);
  for (const r of report.rows.filter((x) => x.status === 'error')) console.log(`     ✗ row ${r.row} ${r.nik} ${r.name}: ${r.errors.join('; ')}`);
  if (APPLY) console.log(`   ✓ created ${report.created}, updated ${report.updated}, failed ${report.failed}; stores created ${report.storesCreated}, areas created ${report.areasCreated}`);
}

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error('Pass the roster .xlsx path as the first argument.');
  console.log(`\n🧹 training-roster-reset ${APPLY ? '(APPLY — writing)' : '(preview — nothing is written; APPLY=1 to write)'}`);

  const keep = await db.select({ id: stores.id }).from(stores).where(inArray(stores.storeNo, KEEP_STORES));
  if (keep.length !== KEEP_STORES.length) throw new Error(`Expected to find ${KEEP_STORES.join(' + ')} — refusing to continue.`);
  const wipeStores = await db.select({ id: stores.id }).from(stores).where(notInArray(stores.storeNo, KEEP_STORES));
  console.log(`   ${wipeStores.length} store(s) to clear, keeping ${KEEP_STORES.join(', ')}`);
  if (wipeStores.length) await wipe(wipeStores.map((s) => s.id));

  await importUsers(file);
  console.log(`\n✅ ${APPLY ? 'done' : 'preview complete'}.`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('\n✗ failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
