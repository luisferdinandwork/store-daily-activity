// scripts/db-baseline.ts
// ─────────────────────────────────────────────────────────────────────────────
// Reconcile drizzle's migration bookkeeping with a database that ALREADY has
// the schema.
//
// Use this when the migration folder has been regenerated from scratch (e.g.
// old migration files were deleted and `npm run db:generate` produced a fresh
// baseline). `drizzle-kit migrate` decides what to run purely by timestamp:
// it re-runs every journal migration whose `when` is newer than the newest
// row in `drizzle.__drizzle_migrations`. A freshly generated baseline is
// always "newer", so `drizzle-kit migrate` would try to `CREATE TABLE`
// everything again and fail with "relation already exists".
//
// This script marks each journal migration as applied WITHOUT running its SQL,
// but only after verifying every table / column / enum it defines already
// exists in the database. If something is missing the migration has real
// unapplied work — the script refuses to stamp it and tells you to run
// `npm run db:migrate` instead.
//
// It is idempotent: migrations already recorded are skipped.
//
//   npm run db:baseline           # stamp pending journal migrations
//   npm run db:baseline -- --dry  # show what would be stamped, change nothing
//
// Normal workflow after this:
//   1. edit lib/db/schema/*
//   2. npm run db:generate        # writes drizzle/migrations/NNNN_*.sql
//   3. review the generated SQL
//   4. npm run db:migrate         # applies only the new migration(s)
//
// If you ever delete the migration files again:
//   npm run db:generate  →  npm run db:baseline  →  carry on as above
// ─────────────────────────────────────────────────────────────────────────────

import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { config } from 'dotenv';
import { Pool } from 'pg';

config({ path: '.env.local' });
config({ path: '.env' });

const MIGRATIONS_DIR = join(process.cwd(), 'drizzle', 'migrations');
const MIGRATIONS_SCHEMA = 'drizzle';
const MIGRATIONS_TABLE = '__drizzle_migrations';

const DRY_RUN = process.argv.includes('--dry') || process.argv.includes('--dry-run');

if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL is not set (.env.local)');
  process.exit(1);
}

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

interface Journal {
  entries: JournalEntry[];
}

// ─── SQL object extraction ───────────────────────────────────────────────────
// drizzle-generated SQL is very regular, so simple regexes are enough. We only
// need to know which top-level objects a migration introduces so we can check
// they already exist.

interface RequiredObjects {
  tables: string[];
  columns: Array<{ table: string; column: string }>;
  enums: string[];
}

function stripQuotes(id: string): string {
  // "public"."foo" -> foo ;  "foo" -> foo ;  foo -> foo
  const last = id.trim().split('.').pop() ?? id;
  return last.replace(/"/g, '').trim();
}

function extractRequiredObjects(sql: string): RequiredObjects {
  const tables: string[] = [];
  const columns: Array<{ table: string; column: string }> = [];
  const enums: string[] = [];

  const createTableRe =
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?("?[\w".]+"?)/gi;
  const createTypeRe =
    /CREATE\s+TYPE\s+("?[\w".]+"?)\s+AS\s+ENUM/gi;
  const addColumnRe =
    /ALTER\s+TABLE\s+("?[\w".]+"?)\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?("?[\w"]+"?)/gi;

  let m: RegExpExecArray | null;
  while ((m = createTableRe.exec(sql))) tables.push(stripQuotes(m[1]));
  while ((m = createTypeRe.exec(sql))) enums.push(stripQuotes(m[1]));
  while ((m = addColumnRe.exec(sql))) {
    columns.push({ table: stripQuotes(m[1]), column: stripQuotes(m[2]) });
  }

  return { tables, columns, enums };
}

// ─── DB helpers ──────────────────────────────────────────────────────────────

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function tableExists(name: string): Promise<boolean> {
  const r = await pool.query(
    `select 1 from information_schema.tables
     where table_schema = 'public' and table_name = $1 limit 1`,
    [name],
  );
  return r.rowCount! > 0;
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const r = await pool.query(
    `select 1 from information_schema.columns
     where table_schema = 'public' and table_name = $1 and column_name = $2 limit 1`,
    [table, column],
  );
  return r.rowCount! > 0;
}

async function enumExists(name: string): Promise<boolean> {
  const r = await pool.query(
    `select 1 from pg_type t
     join pg_namespace n on n.oid = t.typnamespace
     where t.typtype = 'e' and n.nspname = 'public' and t.typname = $1 limit 1`,
    [name],
  );
  return r.rowCount! > 0;
}

async function missingObjects(req: RequiredObjects): Promise<string[]> {
  const missing: string[] = [];

  for (const t of req.tables) {
    if (!(await tableExists(t))) missing.push(`table "${t}"`);
  }
  for (const e of req.enums) {
    if (!(await enumExists(e))) missing.push(`enum "${e}"`);
  }
  for (const c of req.columns) {
    // A missing parent table is already reported above; skip the column check.
    if (req.tables.includes(c.table)) continue;
    if (!(await columnExists(c.table, c.column))) {
      missing.push(`column "${c.table}"."${c.column}"`);
    }
  }

  return missing;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(
    `→ ${process.env.DATABASE_URL!.replace(/:\/\/([^:]+):[^@]*@/, '://$1:***@')}`,
  );
  if (DRY_RUN) console.log('   (dry run — no changes will be written)\n');

  const journal = JSON.parse(
    readFileSync(join(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf8'),
  ) as Journal;

  if (!journal.entries?.length) {
    console.log('No migrations in the journal. Nothing to do.');
    return;
  }

  // Bookkeeping schema + table — identical DDL to drizzle's PgDialect.migrate().
  if (!DRY_RUN) {
    await pool.query(`CREATE SCHEMA IF NOT EXISTS "${MIGRATIONS_SCHEMA}"`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      )
    `);
  }

  let recordedHashes = new Set<string>();
  try {
    const rows = await pool.query(
      `select hash from "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}"`,
    );
    recordedHashes = new Set(rows.rows.map((r) => r.hash as string));
  } catch {
    // table does not exist yet (dry run on a fresh DB) — treat as empty
  }

  let stamped = 0;
  let skipped = 0;

  for (const entry of journal.entries) {
    const sqlPath = join(MIGRATIONS_DIR, `${entry.tag}.sql`);
    const sql = readFileSync(sqlPath, 'utf8');
    // Hash EXACTLY as drizzle-orm/migrator.readMigrationFiles does.
    const hash = createHash('sha256').update(sql).digest('hex');

    if (recordedHashes.has(hash)) {
      console.log(`•  ${entry.tag} — already recorded, skipping`);
      skipped++;
      continue;
    }

    const req = extractRequiredObjects(sql);
    const missing = await missingObjects(req);

    if (missing.length > 0) {
      console.error(
        `\n❌ ${entry.tag} has unapplied changes:\n` +
          missing.map((x) => `     - missing ${x}`).join('\n') +
          `\n\n   This migration must actually run. Use:  npm run db:migrate\n`,
      );
      process.exitCode = 1;
      return;
    }

    console.log(
      `✓  ${entry.tag} — ${req.tables.length} table(s), ` +
        `${req.columns.length} column(s), ${req.enums.length} enum(s) already present` +
        (DRY_RUN ? '  → would stamp' : '  → stamping (SQL not executed)'),
    );

    if (!DRY_RUN) {
      await pool.query(
        `insert into "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" ("hash","created_at")
         values ($1, $2)`,
        [hash, entry.when],
      );
    }
    stamped++;
  }

  console.log(
    `\n${DRY_RUN ? 'Would stamp' : 'Stamped'} ${stamped}, skipped ${skipped}.` +
      (stamped > 0 && !DRY_RUN
        ? `\n✅ Migration history reconciled. New migrations from "npm run db:generate" will now apply cleanly with "npm run db:migrate".`
        : ''),
  );

  await reportColumnDrift();
}

// ─── Column drift check ──────────────────────────────────────────────────────
// The stamp check above only verifies that CREATE TABLE / ADD COLUMN objects
// EXIST. A table that exists but is missing columns (a schema change that never
// reached this DB) slips through — and every `SELECT *`-style query on it then
// fails at runtime. Compare the drizzle schema column-by-column and report.
// Fixes go in a `drizzle-kit generate --custom` migration with ALTER TABLE …
// ADD COLUMN IF NOT EXISTS, then `npm run db:migrate`.

async function reportColumnDrift() {
  let schema: Record<string, unknown>;
  let getTableConfig: (t: never) => { name: string; columns: { name: string }[] };
  try {
    ({ getTableConfig } = await import('drizzle-orm/pg-core'));
    schema = await import('@/lib/db/schema');
  } catch {
    return; // schema not importable in this context — skip the check
  }

  const live = await pool.query<{ table_name: string; column_name: string }>(
    `select table_name, column_name from information_schema.columns where table_schema = 'public'`,
  );
  const liveByTable = new Map<string, Set<string>>();
  for (const r of live.rows) {
    if (!liveByTable.has(r.table_name)) liveByTable.set(r.table_name, new Set());
    liveByTable.get(r.table_name)!.add(r.column_name);
  }

  const drift: string[] = [];
  for (const value of Object.values(schema)) {
    let cfg: { name: string; columns: { name: string }[] };
    try {
      cfg = getTableConfig(value as never);
    } catch {
      continue;
    }
    if (!cfg?.name) continue;

    const actual = liveByTable.get(cfg.name);
    if (!actual) {
      drift.push(`  table "${cfg.name}" is missing entirely`);
      continue;
    }
    const missing = cfg.columns.map((c) => c.name).filter((c) => !actual.has(c));
    if (missing.length) {
      drift.push(`  "${cfg.name}" is missing: ${missing.join(', ')}`);
    }
  }

  if (drift.length === 0) {
    console.log('\n✅ Schema check: every table/column in lib/db/schema exists in the database.');
    return;
  }

  console.warn(
    `\n⚠️  Schema drift — the database is missing objects your code expects:\n` +
      drift.join('\n') +
      `\n\n   Fix: npx drizzle-kit generate --custom --name sync_<thing>\n` +
      `        then put "ALTER TABLE ... ADD COLUMN IF NOT EXISTS ..." in the .sql,\n` +
      `        and run: npm run db:migrate\n`,
  );
}

main()
  .catch((err) => {
    console.error('❌ db:baseline failed:', err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
