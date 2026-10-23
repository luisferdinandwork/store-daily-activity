// scripts/set-user-emails.ts
//
// Fills users.email for the back-office accounts that should receive issue
// emails (lib/db/utils/issues.ts → notifyIssueEvent). Accounts are found by NIK
// (IT) or by name among the Ops users (the Ops accounts came in through the HR
// roster import, so their NIKs are not known here).
//
//   npx tsx scripts/set-user-emails.ts                 # preview on staging
//   npx tsx scripts/set-user-emails.ts --apply         # write staging
//   npx tsx scripts/set-user-emails.ts --prod          # preview on production
//   npx tsx scripts/set-user-emails.ts --prod --apply  # type the DB name to confirm
//
// An email is only written where the user has none, or a different one (shown as
// "~"); nothing is ever cleared. A name that matches zero or several Ops users is
// listed and skipped — fix the name below or set the email in IT Users instead.
// Needs migration 0034 (users.email) on the target first.

import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });
config({ path: '.env', quiet: true });

import readline from 'node:readline';
import { Client } from 'pg';
import { describeTarget, parseTarget } from './lib/db-target';

const args = process.argv.slice(2);
const PROD = args.includes('--prod');
const APPLY = args.includes('--apply');

type Target =
  | { roleCode: 'it'; nik: string; email: string }
  | { roleCode: 'ops'; name: string; email: string };

const TARGETS: Target[] = [
  { roleCode: 'it', nik: 'IT-001', email: 'it@pri.co.id' },
  { roleCode: 'ops', name: 'Indriawan', email: 'indriawan@pri.co.id' },
  { roleCode: 'ops', name: 'Elizakiyah', email: 'Elizakiyah@pri.co.id' },
  { roleCode: 'ops', name: 'M. Syahru Rido', email: 'syahru.rido@pri.co.id' },
  { roleCode: 'ops', name: 'Prihatini Jayanti', email: 'prihatini.jayanti@pri.co.id' },
];

interface UserRow {
  id: string;
  nik: string;
  name: string;
  email: string | null;
  role: string;
  employee_type: string | null;
}

const die = (msg: string): never => {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
};

const tokens = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const compact = (s: string) => tokens(s).join('');

/** Same name ignoring case/punctuation/spaces, or every word of `wanted` present (an initial matches a word start). */
function nameMatches(wanted: string, candidate: string): boolean {
  if (compact(wanted) === compact(candidate)) return true;
  const have = tokens(candidate);
  return tokens(wanted).every((t) => have.some((h) => (t.length === 1 ? h.startsWith(t) : h === t)));
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
  const url = PROD ? process.env.PRODUCTION_DATABASE_URL : process.env.DATABASE_URL;
  if (!url) die(`${PROD ? 'PRODUCTION_DATABASE_URL' : 'DATABASE_URL'} is not set in .env.local.`);

  console.log(`${APPLY ? '✍️  APPLY' : '🔍 PREVIEW — nothing will be changed'}`);
  console.log(`target : ${PROD ? 'PRODUCTION' : 'staging'} — ${describeTarget(url!)}\n`);

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const col = await client.query(
      `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'email'`,
    );
    if ((col.rowCount ?? 0) === 0) {
      die(`users.email does not exist on this database yet — apply migration 0034 first (${PROD ? 'npm run db:migrate:prod' : 'npm run db:migrate'}).`);
    }

    const { rows: candidates } = await client.query<UserRow>(
      `SELECT u.id, u.nik, u.name, u.email, r.code AS role, t.code AS employee_type
         FROM users u
         JOIN user_roles r ON r.id = u.role_id
         LEFT JOIN employee_types t ON t.id = u.employee_type_id
        WHERE u.deleted_at IS NULL AND r.code IN ('it', 'ops')
        ORDER BY u.name`,
    );

    const updates: { user: UserRow; email: string }[] = [];
    let unchanged = 0;
    const problems: string[] = [];

    for (const target of TARGETS) {
      const email = target.email.trim().toLowerCase();
      const label = 'nik' in target ? target.nik : target.name;
      const found = candidates.filter((u) =>
        u.role === target.roleCode && ('nik' in target ? u.nik === target.nik : nameMatches(target.name, u.name)),
      );

      if (found.length === 0) { problems.push(`${label}: no ${target.roleCode} user found`); continue; }
      if (found.length > 1) {
        problems.push(`${label}: ${found.length} users match (${found.map((u) => `${u.name} / ${u.nik}`).join('; ')}) — skipped`);
        continue;
      }

      const user = found[0];
      if (user.email?.toLowerCase() === email) { unchanged += 1; continue; }
      updates.push({ user, email });
    }

    for (const { user, email } of updates) {
      const type = user.employee_type ? ` ${user.employee_type}` : '';
      console.log(`  ${user.email ? '~' : '+'} ${user.nik.padEnd(14)} ${user.name.padEnd(28)} [${user.role}${type}]  ${user.email ? `${user.email} → ` : ''}${email}`);
    }
    for (const p of problems) console.log(`  ✖ ${p}`);
    console.log(`\n  ${updates.length} to set · ${unchanged} already correct · ${problems.length} problem(s)`);

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
    for (const { user, email } of updates) {
      await client.query('UPDATE users SET email = $1, updated_at = now() WHERE id = $2', [email, user.id]);
    }
    await client.query('COMMIT');
    console.log(`\n✅ ${updates.length} user email(s) written.\n`);
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
