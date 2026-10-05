// scripts/migrate-prod.ts
//
// Apply the migrations you developed and tested on staging to PRODUCTION —
// safely, and without touching production data.
//
//   npm run db:migrate:prod -- --dry     # look only: what would run, what's risky (changes nothing)
//   npm run db:migrate:prod              # preview, confirm by typing the DB name, apply
//
// .env.local:
//   DATABASE_URL             staging (what the app, db:migrate, db:seed use)
//   PRODUCTION_DATABASE_URL  production (only this script reads it)
//
// What it does, in order:
//   1. Reads production's migration history (drizzle.__drizzle_migrations) and
//      works out which files in drizzle/migrations are not applied there yet.
//      Stops if production has no history, has migrations this checkout doesn't
//      know about (you're behind), or an applied file was edited afterwards.
//   2. Stops unless staging has already applied every one of those migrations
//      (i.e. you tested them) — override with --skip-staging-check.
//   3. Scans the pending SQL. DROP / TRUNCATE / DELETE / column-type changes
//      are refused unless you pass --allow-destructive; renames, NOT NULL and
//      data updates are flagged as warnings.
//   4. Counts the rows of every production table, asks you to type the
//      database name, then applies everything in ONE transaction with short
//      lock timeouts (so it can't hang the live app).
//   5. Before COMMIT it recounts every table; if any existing table has fewer
//      rows than before, it ROLLS BACK. Any SQL error rolls back too — production
//      is either fully migrated or exactly as it was.
//
// It only ever runs the files already in drizzle/migrations, in order, the same
// way `drizzle-kit migrate` does. It never generates, edits or deletes anything.
// Take a backup (pg_dump) first — a transaction can't undo a bad-but-valid change.

import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: '.env' });

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { Pool, type PoolClient } from 'pg';
import { readMigrationFiles, type MigrationMeta } from 'drizzle-orm/migrator';
import { describeTarget, parseTarget, sameDatabase } from './lib/db-target';

const MIGRATIONS_FOLDER = path.resolve(process.cwd(), 'drizzle/migrations');
const args = new Set(process.argv.slice(2));
const DRY = args.has('--dry');
const ALLOW_DESTRUCTIVE = args.has('--allow-destructive');
const SKIP_STAGING_CHECK = args.has('--skip-staging-check');

// Refused unless --allow-destructive: these remove or rewrite existing data.
const BLOCKING: { re: RegExp; why: string }[] = [
  { re: /\bDROP\s+TABLE\b/i, why: 'DROP TABLE' },
  { re: /\bDROP\s+COLUMN\b/i, why: 'DROP COLUMN' },
  { re: /\bDROP\s+SCHEMA\b/i, why: 'DROP SCHEMA' },
  { re: /\bDROP\s+TYPE\b/i, why: 'DROP TYPE' },
  { re: /\bTRUNCATE\b/i, why: 'TRUNCATE' },
  { re: /\bDELETE\s+FROM\b/i, why: 'DELETE FROM' },
  { re: /\bALTER\s+COLUMN\b[^;]*\bTYPE\b/i, why: 'ALTER COLUMN … TYPE (rewrites data)' },
];
// Allowed, but worth reading before you confirm.
const WARNINGS: { re: RegExp; why: string }[] = [
  { re: /\bRENAME\b/i, why: 'RENAME — the running app breaks until the new code is deployed' },
  { re: /\bSET\s+NOT\s+NULL\b/i, why: 'SET NOT NULL — fails if any row is NULL' },
  { re: /\bADD\s+COLUMN\b(?![^;]*\bDEFAULT\b)[^;]*\bNOT\s+NULL\b/i, why: 'ADD COLUMN NOT NULL without DEFAULT — fails on a non-empty table' },
  { re: /\bDROP\s+(CONSTRAINT|INDEX|DEFAULT|NOT\s+NULL)\b/i, why: 'DROP constraint / index / default' },
  { re: /\bUPDATE\s+"?[\w.]+"?\s+SET\b/i, why: 'UPDATE — changes existing rows' },
  { re: /\bINSERT\s+INTO\b/i, why: 'INSERT — adds rows' },
];

const line = (c = '─') => console.log(c.repeat(64));
const die = (msg: string): never => {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
};

/** SQL with `--` comments removed, so a comment saying "no DROP" can't trip the scan. */
function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, '');
}

async function appliedMigrations(client: Pool | PoolClient): Promise<{ hash: string; created_at: number }[] | null> {
  const exists = await client.query(`select to_regclass('drizzle.__drizzle_migrations') as t`);
  if (!exists.rows[0].t) return null;
  const r = await client.query('select hash, created_at from drizzle.__drizzle_migrations order by created_at');
  return r.rows.map((x) => ({ hash: x.hash as string, created_at: Number(x.created_at) }));
}

async function tableCounts(client: Pool | PoolClient): Promise<Map<string, number>> {
  const t = await client.query(`select tablename from pg_tables where schemaname = 'public' order by tablename`);
  const out = new Map<string, number>();
  for (const { tablename } of t.rows) {
    const c = await client.query(`select count(*)::bigint as n from "${String(tablename).replace(/"/g, '""')}"`);
    out.set(tablename, Number(c.rows[0].n));
  }
  return out;
}

async function confirmByTyping(expected: string): Promise<boolean> {
  if (!process.stdin.isTTY) die('Needs an interactive terminal to confirm. Use --dry to preview without one.');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) =>
    rl.question(`Type the production database name (${expected}) to apply — Enter alone cancels: `, resolve),
  );
  rl.close();
  return answer.trim() === expected;
}

async function main() {
  const prodUrl = process.env.PRODUCTION_DATABASE_URL;
  const stagingUrl = process.env.DATABASE_URL;

  if (!prodUrl) {
    die(
      'PRODUCTION_DATABASE_URL is not set in .env.local.\n' +
        '   Add it (production connection string), and keep DATABASE_URL pointing at staging.',
    );
  }
  const PROD = prodUrl as string;
  if (stagingUrl && sameDatabase(stagingUrl, PROD)) {
    console.warn('⚠️  DATABASE_URL points at production too — your dev environment is NOT on staging.\n');
  }

  console.log(DRY ? '🔍 DRY RUN — nothing will be changed' : '🚀 Production migration');
  line();
  console.log(`production : ${describeTarget(PROD)}`);
  console.log(`staging    : ${stagingUrl ? describeTarget(stagingUrl) : '(DATABASE_URL not set)'}`);
  line();

  // ── Local migration files ────────────────────────────────────────────────
  const journal = JSON.parse(fs.readFileSync(path.join(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf8')) as {
    entries: { idx: number; when: number; tag: string }[];
  };
  const files: MigrationMeta[] = readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER });
  const tagByMillis = new Map(journal.entries.map((e) => [e.when, e.tag]));
  const tagOf = (m: MigrationMeta) => tagByMillis.get(m.folderMillis) ?? String(m.folderMillis);
  if (files.length !== journal.entries.length) die('drizzle/migrations does not match its journal. Run `npx drizzle-kit check`.');

  const prod = new Pool({ connectionString: PROD, connectionTimeoutMillis: 10_000, max: 2 });
  let staging: Pool | null = null;

  try {
    // ── Production history ─────────────────────────────────────────────────
    const applied = await appliedMigrations(prod).catch((e) => die(`Could not read production: ${e.message}`));
    if (!applied || applied.length === 0) {
      die(
        'Production has no migration history (drizzle.__drizzle_migrations is missing or empty).\n' +
          '   Running 0000 here would try to re-create every table. Use `npm run db:baseline` first.',
      );
    }
    const done = applied!;
    const lastApplied = Math.max(...done.map((a) => a.created_at));
    const newestLocal = Math.max(...files.map((f) => f.folderMillis));
    if (lastApplied > newestLocal) {
      die('Production has migrations this checkout does not have — your branch is behind. Pull/merge first.');
    }

    // Same rule drizzle's migrator uses: anything newer than the last applied one runs.
    const pending = files.filter((f) => f.folderMillis > lastApplied);
    const appliedHashes = new Set(done.map((a) => a.hash));
    const edited = files.filter((f) => f.folderMillis <= lastApplied && !appliedHashes.has(f.hash));
    if (edited.length) {
      console.warn('⚠️  These already-applied migration files differ from what production recorded (edited after applying?):');
      for (const f of edited) console.warn(`     ${tagOf(f)}`);
      console.warn('   They will NOT be re-run, but fix this before it confuses you later.\n');
    }

    console.log(`production is at: ${tagOf(files.filter((f) => f.folderMillis <= lastApplied).slice(-1)[0] ?? files[0])}  (${done.length} applied)`);
    if (pending.length === 0) {
      console.log('\n✅ Production is already up to date. Nothing to do.');
      return;
    }
    console.log(`\npending (${pending.length}):`);
    for (const m of pending) console.log(`  • ${tagOf(m)}  — ${m.sql.length} statement${m.sql.length === 1 ? '' : 's'}`);

    // ── Was it tested on staging? ──────────────────────────────────────────
    if (!SKIP_STAGING_CHECK) {
      if (!stagingUrl) die('DATABASE_URL (staging) is not set, so I cannot confirm these ran on staging. (--skip-staging-check to override)');
      staging = new Pool({ connectionString: stagingUrl, connectionTimeoutMillis: 10_000, max: 1 });
      const sApplied = await appliedMigrations(staging).catch((e) => die(`Could not read staging: ${e.message}`));
      const sHashes = new Set((sApplied ?? []).map((a) => a.hash));
      const missing = pending.filter((m) => !sHashes.has(m.hash));
      if (missing.length) {
        die(
          'Staging has not applied these migrations yet — test them there first (`npm run db:migrate` against staging):\n' +
            missing.map((m) => `     ${tagOf(m)}`).join('\n') +
            '\n   (--skip-staging-check to override)',
        );
      }
      console.log('\n✔ staging has already applied all of them');
    } else {
      console.warn('\n⚠️  staging check skipped');
    }

    // ── Risk scan ──────────────────────────────────────────────────────────
    const blocked: string[] = [];
    const warned: string[] = [];
    for (const m of pending) {
      for (const stmt of m.sql) {
        const clean = stripComments(stmt);
        const first = clean.trim().split('\n')[0].slice(0, 90);
        for (const b of BLOCKING) if (b.re.test(clean)) blocked.push(`${tagOf(m)}: ${b.why}  →  ${first}`);
        for (const w of WARNINGS) if (w.re.test(clean)) warned.push(`${tagOf(m)}: ${w.why}  →  ${first}`);
      }
    }
    if (warned.length) {
      console.log('\n⚠️  review:');
      for (const w of warned) console.log(`   ${w}`);
    }
    if (blocked.length) {
      console.log('\n⛔ destructive statements:');
      for (const b of blocked) console.log(`   ${b}`);
      if (!ALLOW_DESTRUCTIVE) {
        die('Refusing: the migrations above can delete or rewrite production data.\n   If intended, read them, take a backup, and re-run with --allow-destructive.');
      }
      console.warn('\n⚠️  --allow-destructive given');
    }

    // ── Row counts before ──────────────────────────────────────────────────
    const before = await tableCounts(prod);
    const totalRows = [...before.values()].reduce((a, b) => a + b, 0);
    console.log(`\nproduction right now: ${before.size} tables, ${totalRows.toLocaleString('en-US')} rows (will be re-checked before commit)`);

    if (DRY) {
      console.log('\n🔍 Dry run complete — nothing was changed.');
      return;
    }

    // ── Confirm + apply ────────────────────────────────────────────────────
    console.log('\nHave you taken a fresh backup (pg_dump) of production? This runs against LIVE data.');
    if (!(await confirmByTyping(parseTarget(PROD).database))) die('Cancelled. Nothing was changed.');

    const client = await prod.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL lock_timeout = '10s'`);
      await client.query(`SET LOCAL statement_timeout = '5min'`);
      await client.query('select pg_advisory_xact_lock(hashtext($1))', ['prism-migrate-prod']);

      // Re-read inside the lock: a second run (or someone else) may have applied them.
      const again = await appliedMigrations(client);
      const lastNow = Math.max(...(again ?? []).map((a) => a.created_at));
      if (lastNow !== lastApplied) throw new Error('Production changed while waiting — re-run the script.');

      for (const m of pending) {
        console.log(`\n→ ${tagOf(m)}`);
        for (const stmt of m.sql) await client.query(stmt);
        await client.query('insert into drizzle.__drizzle_migrations ("hash", "created_at") values ($1, $2)', [m.hash, m.folderMillis]);
      }

      // Data-preservation check, inside the same transaction.
      const after = await tableCounts(client);
      const lost = [...before].filter(([t, n]) => (after.get(t) ?? 0) < n);
      if (lost.length) {
        throw new Error('Row counts dropped — ROLLED BACK:\n' + lost.map(([t, n]) => `     ${t}: ${n} → ${after.get(t) ?? 'gone'}`).join('\n'));
      }

      await client.query('COMMIT');
      const added = [...after].filter(([t, n]) => n > (before.get(t) ?? 0));
      console.log(`\n✅ Applied ${pending.length} migration${pending.length === 1 ? '' : 's'} to production. No rows lost across ${before.size} tables.`);
      if (added.length) console.log(`   rows added: ${added.map(([t, n]) => `${t} +${n - (before.get(t) ?? 0)}`).join(', ')}`);
      console.log('   Next: deploy the matching code (migrate first, then deploy).');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      die(`${err instanceof Error ? err.message : String(err)}\n\n   Production was rolled back — nothing changed.`);
    } finally {
      client.release();
    }
  } finally {
    await prod.end().catch(() => undefined);
    await staging?.end().catch(() => undefined);
  }
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)));
