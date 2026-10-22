import '../lib/not-production';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { hash } from 'bcryptjs';
import { and, eq, isNull } from 'drizzle-orm';
import { db, pool } from '@/lib/db';
import { areas, employeeTypes, stores, storeVisitConfig, storeVisitPolicies, storeVisits, userRoles, users } from '@/lib/db/schema';
import { addDaysKey, isDayKey, jakartaTodayKey, jakartaWallClock } from '@/lib/day-bucket';
import { cycleContaining, previousCycle } from '@/lib/store-visit/cycles';
import type { VisitAnswer } from '@/lib/store-visit/types';

const apply = process.argv.includes('--apply');
const today = process.argv.find((a) => a.startsWith('--today='))?.slice(8) ?? jakartaTodayKey();
assert.ok(isDayKey(today) && today <= jakartaTodayKey(), 'Use a real WIB day, no later than today.');
const marker = '[DEMO VISIT STAGING v1]';
const photoUrl = '/demo/store-visit.svg';
const uuid = (key: string) => {
  const hex = createHash('sha256').update(key).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

async function run() {
  const [storeRows, policyRows, [config], opsRows, [role], [type]] = await Promise.all([
    db.select({ store: stores, areaName: areas.name }).from(stores).innerJoin(areas, eq(areas.id, stores.areaId)).where(eq(stores.status, 'active')).orderBy(stores.storeNo),
    db.select().from(storeVisitPolicies),
    db.select().from(storeVisitConfig).where(eq(storeVisitConfig.id, 1)),
    db.select({ id: users.id, nik: users.nik, name: users.name, areaId: users.areaId }).from(users)
      .innerJoin(employeeTypes, eq(users.employeeTypeId, employeeTypes.id)).innerJoin(userRoles, eq(users.roleId, userRoles.id))
      .where(and(eq(userRoles.code, 'ops'), eq(employeeTypes.code, 'ops_area'), eq(users.isActive, true), isNull(users.deletedAt))),
    db.select().from(userRoles).where(eq(userRoles.code, 'ops')),
    db.select().from(employeeTypes).where(eq(employeeTypes.code, 'ops_area')),
  ]);
  assert.ok(config?.tasks.length && role && type, 'Visit configuration and Ops lookups must already exist.');
  const policyByCode = new Map(policyRows.map((p) => [p.storeNo, p]));
  const areaNames = new Map(storeRows.map((r) => [r.store.areaId, r.areaName]));
  const demoUsers = [...areaNames].map(([areaId, name]) => ({ id: `VISIT-DEMO-AREA-${areaId}`, nik: `VISIT-DEMO-AREA-${areaId}`, name: `Demo Visit · ${name}`, areaId }));
  const allUsers = await db.select({ id: users.id, nik: users.nik, roleId: users.roleId, employeeTypeId: users.employeeTypeId, areaId: users.areaId, isActive: users.isActive, deletedAt: users.deletedAt }).from(users);
  for (const demo of demoUsers) {
    const existing = allUsers.find((u) => u.id === demo.id || u.nik === demo.nik);
    assert.ok(!existing || (existing.id === demo.id && existing.nik === demo.nik && existing.roleId === role.id && existing.employeeTypeId === type.id && existing.areaId === demo.areaId && existing.isActive && !existing.deletedAt), `Demo account collision: ${demo.nik}`);
  }
  const primary = new Map<number, string>();
  const secondary = new Map<number, string>();
  for (const demo of demoUsers) {
    const existing = opsRows.find((u) => u.areaId === demo.areaId && u.id !== demo.id);
    primary.set(demo.areaId, existing?.id ?? demo.id);
    secondary.set(demo.areaId, demo.id);
  }
  const visits: (typeof storeVisits.$inferInsert)[] = [];
  for (const [index, { store }] of storeRows.entries()) {
    const policy = policyByCode.get(store.storeNo);
    const interval = policy?.intervalDays ?? 7;
    const owner = primary.get(store.areaId)!;
    const peer = secondary.get(store.areaId)!;
    let cycle = cycleContaining(today, interval);
    const pattern = index % 4;
    const add = (day: string, visitor: string, slot = 0) => {
      const at = jakartaWallClock(day, slot ? '14:00' : '10:00');
      if (at > new Date()) return;
      const geo = { lat: Number(store.latitude ?? '-6.168'), lng: Number(store.longitude ?? '106.714'), accuracy: 10, capturedAt: at.toISOString() };
      const answers: Record<string, VisitAnswer> = Object.fromEntries(config.tasks.map((task, taskIndex) => {
        const finding = (index + taskIndex + slot) % 5 === 0;
        return [task.id, { answer: finding ? 'tidak' : 'ya', note: finding ? 'Temuan simulasi: perlu tindak lanjut penataan dan kebersihan.' : '', ...(task.requirePhoto ? { photoUrl, photoGeo: geo } : {}) }];
      }));
      visits.push({ id: uuid(`${marker}:${store.storeNo}:${day}:${visitor}:${slot}`), storeId: store.id, visitedBy: visitor,
        visitedAt: at, photoUrl, photoGeo: geo, lat: String(geo.lat), lng: String(geo.lng), accuracy: '10', distanceM: 0,
        tasks: config.tasks, answers, notes: `${marker} Skenario ${pattern + 1}; bukti dan lokasi simulasi untuk pengujian laporan.` });
    };
    // Regular visits, missed current cycle, missed history, and repeat visits on one day.
    for (let age = 0; age <= (interval === 7 ? 7 : 1); age++) {
      const met = age === 0 ? pattern === 0 || pattern === 3 : pattern === 0 || (pattern === 1 && age % 2 === 1) || (pattern === 2 && age >= 3);
      if (met) {
        for (let n = 0; n < (policy?.minimumVisits ?? 1); n++) {
          const day = addDaysKey(cycle.start, n);
          if (day <= today) add(day, owner);
        }
        if (age === 0 && pattern === 3) add(cycle.start, owner, 1);
      }
      // A colleague's visit must never complete the primary owner's personal report.
      if (age === 0 && peer !== owner && pattern === 1) add(cycle.start, peer);
      cycle = previousCycle(cycle, interval);
    }
  }
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'preview', today, activeStores: storeRows.length, storesWithPolicy: storeRows.filter((r) => policyByCode.has(r.store.storeNo)).length,
    visitsPlanned: visits.length, demoAccounts: demoUsers.map((u) => ({ nik: u.nik, area: areaNames.get(u.areaId), new: !allUsers.some((v) => v.id === u.id) })),
    note: 'Insert-only, deterministic IDs. Existing visits, users/passwords, policies and configuration are preserved.' }, null, 2));
  if (!apply) return;
  const password = await hash('password123', 10);
  for (const user of demoUsers) {
    await db.insert(users).values({ ...user, password, roleId: role.id, employeeTypeId: type.id }).onConflictDoNothing();
  }
  let inserted = 0;
  for (let start = 0; start < visits.length; start += 100) {
    const saved = await db.insert(storeVisits).values(visits.slice(start, start + 100)).onConflictDoNothing().returning({ id: storeVisits.id });
    inserted += saved.length;
  }
  console.log(`Inserted ${inserted} demo visits; ${visits.length - inserted} already existed. New demo accounts use password123.`);
}

run().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => pool.end());
