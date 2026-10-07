// scripts/import-store-emails.ts
//
// Bulk-fill stores.email (the mailbox "Lupa password" checks and emails — see
// lib/db/utils/password-reset.ts) from a CSV/XLSX with a store-code column and
// an email column:
//
//   Store Code,Store Name,Email          (Store Name is ignored — for humans)
//   FF001,Fisik Football - Daan Mogot,daanmogot@fisikfootball.com
//
//   npx tsx scripts/import-store-emails.ts data/store-emails.csv               # preview on staging
//   npx tsx scripts/import-store-emails.ts data/store-emails.csv --apply       # write staging
//   npx tsx scripts/import-store-emails.ts data/store-emails.csv --prod        # preview on production
//   npx tsx scripts/import-store-emails.ts data/store-emails.csv --prod --apply  # type the DB name to confirm
//
// Only stores named in the file are touched, and an email is never cleared.
// Codes the target DB doesn't have are listed and skipped (staging only has a
// few stores). Everything lands in one transaction. Needs migration 0026
// (stores.email) on the target first.

import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });
config({ path: '.env', quiet: true });

import path from 'node:path';
import readline from 'node:readline';
import { Client } from 'pg';
import * as XLSX from 'xlsx';
import { describeTarget, parseTarget } from './lib/db-target';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const PROD = args.includes('--prod');
const APPLY = args.includes('--apply');

const CODE_HEADERS = ['store code', 'store_no', 'store no', 'kode toko', 'kode', 'code'];
const EMAIL_HEADERS = ['email', 'store email', 'email toko'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const die = (msg: string): never => {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
};

function readRows(filePath: string): { code: string; email: string; line: number }[] {
  const wb = XLSX.readFile(filePath, { raw: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const table = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: '', raw: false });
  if (table.length < 2) die('The file has no data rows.');

  const header = table[0].map((h) => String(h).trim().toLowerCase());
  const codeCol = header.findIndex((h) => CODE_HEADERS.includes(h));
  const emailCol = header.findIndex((h) => EMAIL_HEADERS.includes(h));
  if (codeCol < 0) die(`No store-code column. Expected one of: ${CODE_HEADERS.join(', ')}.`);
  if (emailCol < 0) die(`No email column. Expected one of: ${EMAIL_HEADERS.join(', ')}.`);

  return table
    .slice(1)
    .map((r, i) => ({
      code: String(r[codeCol] ?? '').trim().toUpperCase(),
      email: String(r[emailCol] ?? '').trim().toLowerCase(),
      line: i + 2,
    }))
    .filter((r) => r.code || r.email);
}

async function confirm(expected: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) =>
    rl.question(`\nType the production database name (${expected}) to apply: `, resolve),
  );
  rl.close();
  return answer.trim() === expected;
}

async function main() {
  if (!file) die('Usage: npx tsx scripts/import-store-emails.ts <file.csv|xlsx> [--prod] [--apply]');
  const url = PROD ? process.env.PRODUCTION_DATABASE_URL : process.env.DATABASE_URL;
  if (!url) die(`${PROD ? 'PRODUCTION_DATABASE_URL' : 'DATABASE_URL'} is not set in .env.local.`);

  const rows = readRows(path.resolve(file!));

  console.log(`${APPLY ? '✍️  APPLY' : '🔍 PREVIEW — nothing will be changed'}`);
  console.log(`target : ${PROD ? 'PRODUCTION' : 'staging'} — ${describeTarget(url!)}`);
  console.log(`file   : ${file} (${rows.length} rows)\n`);

  // Problems inside the file itself.
  const bad = rows.filter((r) => !r.code || !EMAIL_RE.test(r.email));
  for (const r of bad) console.log(`  ✖ line ${r.line}: ${!r.code ? 'missing store code' : `invalid email "${r.email}"`}`);
  const seen = new Map<string, number>();
  for (const r of rows) seen.set(r.code, (seen.get(r.code) ?? 0) + 1);
  const dupCodes = [...seen].filter(([c, n]) => c && n > 1).map(([c]) => c);
  if (dupCodes.length) console.log(`  ✖ store code listed more than once: ${dupCodes.join(', ')}`);
  if (bad.length || dupCodes.length) die('Fix the file first — nothing was changed.');

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const col = await client.query(
      `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'stores' AND column_name = 'email'`,
    );
    const hasColumn = (col.rowCount ?? 0) > 0;

    const { rows: stores } = await client.query<{ id: number; store_no: string; name: string; email: string | null }>(
      `SELECT id, store_no, name, ${hasColumn ? 'email' : 'NULL::text AS email'} FROM stores ORDER BY store_no`,
    );
    const byCode = new Map(stores.map((s) => [s.store_no.toUpperCase(), s]));

    const updates: { id: number; code: string; name: string; from: string | null; to: string }[] = [];
    const unchanged: string[] = [];
    const missing: string[] = [];
    for (const r of rows) {
      const store = byCode.get(r.code);
      if (!store) { missing.push(r.code); continue; }
      if (store.email === r.email) { unchanged.push(r.code); continue; }
      updates.push({ id: store.id, code: r.code, name: store.name, from: store.email, to: r.email });
    }
    const inFile = new Set(rows.map((r) => r.code));
    const notInFile = stores.filter((s) => !inFile.has(s.store_no.toUpperCase()));

    for (const u of updates) {
      console.log(`  ${u.from ? '~' : '+'} ${u.code.padEnd(9)} ${u.name.padEnd(42)} ${u.from ? `${u.from} → ` : ''}${u.to}`);
    }
    console.log('');
    console.log(`  ${updates.length} to set · ${unchanged.length} already correct · ${missing.length} not in this DB`);
    if (missing.length) console.log(`  not in this DB (skipped): ${missing.join(', ')}`);
    if (notInFile.length) {
      console.log(`  stores not in the file (left as they are): ${notInFile.map((s) => `${s.store_no}${s.email ? '' : ' (no email)'}`).join(', ')}`);
    }

    if (!hasColumn) {
      die(`stores.email does not exist on this database yet — apply migration 0026 first (${PROD ? 'npm run db:migrate:prod' : 'npm run db:migrate'}).`);
    }
    if (!APPLY) {
      console.log('\n🔍 Preview only. Re-run with --apply to write.\n');
      return;
    }
    if (updates.length === 0) {
      console.log('\n✔ Nothing to change.\n');
      return;
    }
    if (PROD && !(await confirm(parseTarget(url!).database))) die('Name did not match — nothing was changed.');

    await client.query('BEGIN');
    for (const u of updates) {
      await client.query('UPDATE stores SET email = $1, updated_at = now() WHERE id = $2', [u.to, u.id]);
    }
    await client.query('COMMIT');
    console.log(`\n✅ ${updates.length} store email(s) written.\n`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
