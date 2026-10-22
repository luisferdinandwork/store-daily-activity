// Read production master data; merge into staging without replacing local IDs/history.
// Preview by default. Run with --apply to write staging only.
import '../lib/not-production';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { db, pool } from '@/lib/db';
import { areas, stores } from '@/lib/db/schema';
import { changeStoreStatus } from '@/lib/db/utils/store-status';
import { canTransitionStoreStatus } from '@/lib/store-status';
import { sameDatabase } from '../lib/db-target';

const apply = process.argv.includes('--apply');
const sourceUrl = process.env.PRODUCTION_DATABASE_URL;
assert.ok(sourceUrl && process.env.DATABASE_URL, 'Both database URLs are required.');
assert.ok(!sameDatabase(sourceUrl, process.env.DATABASE_URL), 'Source and target must differ.');
// Even accidental writes through the source connection are rejected by Postgres.
const sourcePool = new Pool({ connectionString: sourceUrl, options: '-c default_transaction_read_only=on', connectionTimeoutMillis: 10_000 });
const source = drizzle(sourcePool);

async function run() {
  const [prodAreas, prodStores, localAreas, localStores] = await Promise.all([
    source.select({ id: areas.id, name: areas.name }).from(areas),
    source.select({ storeNo: stores.storeNo, name: stores.name, address: stores.address,
      latitude: stores.latitude, longitude: stores.longitude, geofenceRadiusM: stores.geofenceRadiusM,
      areaId: stores.areaId, deptCode: stores.deptCode, email: stores.email, status: stores.status,
    }).from(stores),
    db.select().from(areas), db.select().from(stores),
  ]);
  const normalize = (name: string) => name.trim().toUpperCase();
  assert.equal(new Set(prodAreas.map((a) => normalize(a.name))).size, prodAreas.length, 'Duplicate production area names.');
  assert.equal(new Set(localAreas.map((a) => normalize(a.name))).size, localAreas.length, 'Ambiguous staging area names.');
  const areasByName = new Map(localAreas.map((a) => [normalize(a.name), a]));
  const storesByCode = new Map(localStores.map((s) => [s.storeNo, s]));
  for (const store of prodStores) {
    const existing = storesByCode.get(store.storeNo);
    assert.ok(prodAreas.some((a) => a.id === store.areaId), 'Production area missing.');
    if (existing && existing.status !== store.status) {
      assert.ok(canTransitionStoreStatus(existing.status, store.status), `Unsupported status transition for ${store.storeNo}.`);
    }
    assert.ok(!store.deptCode || !localStores.some((s) => s.deptCode === store.deptCode && s.storeNo !== store.storeNo), `Department code conflict for ${store.storeNo}.`);
  }
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'preview', sourceAreas: prodAreas.length, sourceStores: prodStores.length,
    newAreas: prodAreas.filter((a) => !areasByName.has(normalize(a.name))).length,
    newStores: prodStores.filter((s) => !storesByCode.has(s.storeNo)).length,
    matchedStores: prodStores.filter((s) => storesByCode.has(s.storeNo)).length,
    note: 'Staging IDs, users, financial balances and activity are preserved. No production users or financial data are copied.' }, null, 2));
  if (!apply) return;

  const backupDir = join(tmpdir(), 'prism-staging-master-backups');
  await mkdir(backupDir, { recursive: true });
  const backup = join(backupDir, `areas-stores-${Date.now()}.json`);
  await writeFile(backup, JSON.stringify({ areas: localAreas, stores: localStores }, null, 2), { flag: 'wx' });
  console.log(`Staging master backup: ${backup}`);

  const areaIds = new Map<number, number>();
  for (const area of prodAreas) {
    let local = areasByName.get(normalize(area.name));
    if (!local) {
      [local] = await db.insert(areas).values({ name: area.name }).returning();
      areasByName.set(normalize(area.name), local);
    }
    areaIds.set(area.id, local.id);
  }
  for (const store of prodStores) {
    const existing = storesByCode.get(store.storeNo);
    const { status, ...metadata } = store;
    const values = { ...metadata, areaId: areaIds.get(store.areaId)! };
    if (existing) {
      await db.update(stores).set({ ...values, updatedAt: new Date() }).where(eq(stores.id, existing.id));
      if (existing.status !== status) {
        const changed = await changeStoreStatus({ storeId: existing.id, to: status, actorId: null, note: 'Staging master sync from production' });
        assert.ok(changed.success, changed.success ? '' : changed.error);
      }
    } else {
      await db.insert(stores).values({ ...values, status, pettyCashBalance: status === 'ready_to_open' ? '0' : '1000000' });
    }
  }
  const synced = await db.select({ storeNo: stores.storeNo, name: stores.name, areaId: stores.areaId, status: stores.status }).from(stores);
  for (const store of prodStores) {
    const local = synced.find((s) => s.storeNo === store.storeNo);
    assert.ok(local && local.name === store.name && local.areaId === areaIds.get(store.areaId) && local.status === store.status, `Verification failed: ${store.storeNo}`);
  }
  console.log(`Verified ${prodAreas.length} production areas and ${prodStores.length} stores in staging.`);
}

run().catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => { await Promise.all([sourcePool.end(), pool.end()]); });
