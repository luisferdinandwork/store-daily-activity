// scripts/seed-bazaar-stores.ts
//
// Creates the reusable "Bazaar" store slots BZ001–BZ003. They sit in a BAZAAR area,
// status `ready_to_open` (prep-only: Ops can move employees in and build
// schedules / targets; nothing records until IT sets the real location and
// activates the store). Address + coordinates are the same placeholders the IT
// user import uses (DEFAULT_STORE_LOCATION) — IT replaces them in Store Management.
//
//   npx tsx scripts/seed-bazaar-stores.ts                  # preview on staging
//   npx tsx scripts/seed-bazaar-stores.ts --apply          # write staging
//   npx tsx scripts/seed-bazaar-stores.ts --prod           # preview on production
//   npx tsx scripts/seed-bazaar-stores.ts --prod --apply   # type the DB name to confirm
//
// Idempotent: a store code that already exists is left alone, the area is reused
// if it exists. Everything lands in one transaction.

import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });
config({ path: '.env', quiet: true });

import readline from 'node:readline';
import { Client } from 'pg';
import { describeTarget, parseTarget } from './lib/db-target';

const args = process.argv.slice(2);
const PROD = args.includes('--prod');
const APPLY = args.includes('--apply');

const AREA_NAME = 'BAZAAR';
const STORES = [
  { storeNo: 'BZ001', name: 'Bazaar 1' },
  { storeNo: 'BZ002', name: 'Bazaar 2' },
  { storeNo: 'BZ003', name: 'Bazaar 3' },
];

// Same values as DEFAULT_STORE_LOCATION / DEFAULT_STORE_ADDRESS in lib/user-import.ts.
const PLACEHOLDER = { address: 'Alamat belum diisi', latitude: '-6.1630687', longitude: '106.7739266', radius: '150' };

const die = (msg: string): never => {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
};

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

  console.log(APPLY ? '✍️  APPLY' : '🔍 PREVIEW — nothing will be changed');
  console.log(`target : ${PROD ? 'PRODUCTION' : 'staging'} — ${describeTarget(url!)}\n`);

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const { rows: statusCol } = await client.query(
      `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'stores' AND column_name = 'status'`,
    );
    if (!statusCol.length) die('stores.status does not exist on this database yet — apply the migrations first.');

    const { rows: [area] } = await client.query<{ id: number }>('SELECT id FROM areas WHERE upper(name) = $1 LIMIT 1', [AREA_NAME]);
    const { rows: existing } = await client.query<{ store_no: string; name: string }>(
      'SELECT store_no, name FROM stores WHERE store_no = ANY($1)',
      [STORES.map((s) => s.storeNo)],
    );
    const have = new Set(existing.map((s) => s.store_no));
    const toCreate = STORES.filter((s) => !have.has(s.storeNo));

    console.log(`  area   ${AREA_NAME.padEnd(8)} ${area ? `exists (id ${area.id})` : '+ will be created'}`);
    for (const s of STORES) {
      console.log(`  store  ${s.storeNo.padEnd(8)} ${s.name.padEnd(10)} ${have.has(s.storeNo) ? 'already exists — left as is' : '+ will be created (Ready to Open)'}`);
    }

    if (!APPLY) {
      console.log('\n🔍 Preview only. Re-run with --apply to write.\n');
      return;
    }
    if (toCreate.length === 0) {
      console.log('\n✔ Nothing to change.\n');
      return;
    }
    if (PROD && !(await confirm(parseTarget(url!).database))) die('Name did not match — nothing was changed.');

    await client.query('BEGIN');
    const areaId =
      area?.id ??
      (await client.query<{ id: number }>('INSERT INTO areas (name) VALUES ($1) RETURNING id', [AREA_NAME])).rows[0].id;

    for (const s of toCreate) {
      const { rows: [created] } = await client.query<{ id: number }>(
        `INSERT INTO stores (store_no, name, address, latitude, longitude, geofence_radius_m, area_id, status, status_changed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'ready_to_open', now())
         RETURNING id`,
        [s.storeNo, s.name, PLACEHOLDER.address, PLACEHOLDER.latitude, PLACEHOLDER.longitude, PLACEHOLDER.radius, areaId],
      );
      await client.query(
        `INSERT INTO store_status_history (store_id, from_status, to_status, note) VALUES ($1, NULL, 'ready_to_open', $2)`,
        [created.id, 'Bazaar slot created by seed-bazaar-stores.ts'],
      );
    }
    await client.query('COMMIT');
    console.log(`\n✅ ${toCreate.length} store(s) created${area ? '' : ` (+ area ${AREA_NAME})`}.\n`);
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
