import '../lib/not-production';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { hash } from 'bcryptjs';
import { and, eq, isNull, like } from 'drizzle-orm';
import { db, pool } from '@/lib/db';
import { areas, employeeTypes, stores, storeVisitConfig, storeVisitPolicies, storeVisits, userRoles, users } from '@/lib/db/schema';
import { addDaysKey, isDayKey, jakartaTodayKey, jakartaWallClock } from '@/lib/day-bucket';
import { cycleContaining, daysBetween, previousCycle, type VisitCycle } from '@/lib/store-visit/cycles';
import type { VisitAnswer } from '@/lib/store-visit/types';

// Demo visits for the Report Visit page (staging only). Every store gets a visit "story" picked
// from its store code, so the calendar shows every colour: steady stores, stores that slipped,
// a chronic miss, a store never visited, double visits, long-cycle (60/90 day) stores that are
// fresh / due / overdue. IDs are deterministic; rows are labelled with MARKER_PREFIX.
//
//   npx tsx scripts/seed/store-visit-demo.ts                 preview
//   npx tsx scripts/seed/store-visit-demo.ts --apply         insert (adds what's missing)
//   npx tsx scripts/seed/store-visit-demo.ts --apply --replace   first delete earlier demo rows (v1/v2 markers only)

const apply = process.argv.includes('--apply');
const replace = process.argv.includes('--replace');
const today = process.argv.find((a) => a.startsWith('--today='))?.slice(8) ?? jakartaTodayKey();
assert.ok(isDayKey(today) && today <= jakartaTodayKey(), 'Use a real WIB day, no later than today.');
const MARKER_PREFIX = '[DEMO VISIT STAGING';
const marker = `${MARKER_PREFIX} v2]`;
const photoUrl = '/demo/store-visit.svg';

const sha = (key: string) => createHash('sha256').update(key).digest('hex');
const uuid = (key: string) => {
  const hex = sha(key);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};
/** Deterministic random stream per key (mulberry32 seeded from a hash). */
function rng(key: string) {
  let a = parseInt(sha(key).slice(0, 8), 16) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FINDINGS = [
  'Display kaos belum rapi, perlu ditata ulang per ukuran.',
  'Lantai area kasir kotor, jadwal kebersihan belum dijalankan.',
  'Stok sepatu di gudang belum disusun per kode.',
  'Signage promo sudah kedaluwarsa, mohon diganti.',
  'Fitting room kurang pencahayaan, satu lampu mati.',
  'Mannequin belum mengikuti VM terbaru.',
  'Selisih kecil antara stok sistem dan fisik di rak aksesoris.',
  'Seragam staf belum lengkap (name tag).',
];

// Weekly (1 visit / 7 days) stories: how many visits in the cycle `age` weeks back (0 = this week).
type Story = (age: number, r: () => number) => number;
const WEEKLY: { name: string; visits: Story }[] = [
  { name: 'steady', visits: () => 1 },
  { name: 'early-bird', visits: () => 1 },
  { name: 'slipping', visits: (age) => (age <= 2 ? 0 : 1) },
  { name: 'fresh-miss', visits: (age) => (age <= 1 ? 0 : 1) },
  { name: 'on-off', visits: (age, r) => (age % 2 === 0 ? 0 : r() < 0.85 ? 1 : 0) },
  { name: 'never', visits: () => 0 },
  { name: 'double', visits: (age, r) => (age === 0 ? 2 : r() < 0.5 ? 2 : 1) },
  { name: 'chronic', visits: (age) => (age === 5 || age === 7 ? 1 : 0) },
  { name: 'steady', visits: (age, r) => (age === 0 ? (r() < 0.6 ? 1 : 0) : 1) },
  { name: 'late-week', visits: (age) => (age === 0 ? 0 : 1) },
];
// Long-cycle (60 / 90 day) stories: visits in the cycle `age` cycles back (0 = current).
const LONG: { name: string; visits: Story }[] = [
  { name: 'fresh', visits: () => 1 },
  { name: 'due', visits: (age) => (age === 0 ? 0 : 1) },
  { name: 'overdue', visits: (age) => (age <= 1 ? 0 : 1) },
  { name: 'rebound', visits: (age) => (age === 1 ? 0 : 1) },
  { name: 'fresh', visits: (age) => (age === 1 ? 0 : 1) },
  { name: 'due', visits: (age) => (age === 0 ? 0 : age === 1 ? 1 : 0) },
  { name: 'never', visits: () => 0 },
];

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

  // Stories go round the stores in a fixed shuffled order (not a dice roll), so every colour shows up.
  const classOf = (code: string) => ((policyByCode.get(code)?.intervalDays ?? 7) > 7 ? 'long' : 'weekly');
  const storyIndex = new Map<string, number>();
  for (const cls of ['weekly', 'long']) {
    storeRows.map((r) => r.store.storeNo).filter((c) => classOf(c) === cls)
      .sort((a, b) => sha(`${marker}:order:${a}`).localeCompare(sha(`${marker}:order:${b}`)))
      .forEach((code, i) => storyIndex.set(code, i));
  }

  const visits: (typeof storeVisits.$inferInsert)[] = [];
  const stories: Record<string, number> = {};
  const now = new Date();
  for (const { store } of storeRows) {
    const policy = policyByCode.get(store.storeNo);
    const interval = policy?.intervalDays ?? 7;
    const minimum = policy?.minimumVisits ?? 1;
    const r = rng(`${marker}:${store.storeNo}`);
    const owner = primary.get(store.areaId)!;
    const peer = secondary.get(store.areaId)!;
    const catalogue = interval > 7 ? LONG : WEEKLY;
    const story = catalogue[(storyIndex.get(store.storeNo) ?? 0) % catalogue.length];
    stories[`${interval > 7 ? `${interval}d` : '7d'}:${story.name}`] = (stories[`${interval > 7 ? `${interval}d` : '7d'}:${story.name}`] ?? 0) + 1;

    const add = (day: string, visitor: string, n: number) => {
      const minutes = 9 * 60 + Math.floor(r() * 7.5 * 60);
      const at = jakartaWallClock(day, `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`);
      if (at > now) return;
      const geo = { lat: Number(store.latitude ?? '-6.168'), lng: Number(store.longitude ?? '106.714'), accuracy: 8 + Math.floor(r() * 25), capturedAt: at.toISOString() };
      // 0–4 findings per visit, spread over different checklist items.
      const findings = Math.floor(r() * 5);
      const flagged = new Set(config.tasks.map((_, i) => i).sort(() => r() - 0.5).slice(0, findings));
      const answers: Record<string, VisitAnswer> = Object.fromEntries(config.tasks.map((task, i) => {
        const finding = flagged.has(i);
        return [task.id, { answer: finding ? 'tidak' : 'ya', note: finding ? FINDINGS[Math.floor(r() * FINDINGS.length)] : '', ...(task.requirePhoto ? { photoUrl, photoGeo: geo } : {}) }];
      }));
      visits.push({
        id: uuid(`${marker}:${store.storeNo}:${day}:${visitor}:${n}`), storeId: store.id, visitedBy: visitor,
        visitedAt: at, photoUrl, photoGeo: geo, lat: String(geo.lat), lng: String(geo.lng), accuracy: String(geo.accuracy), distanceM: Math.floor(r() * 40),
        tasks: config.tasks, answers, notes: `${marker} ${interval > 7 ? '' : 'Mingguan'} cerita "${story.name}"; bukti dan lokasi simulasi untuk pengujian laporan.`.replace('  ', ' '),
      });
    };

    // Distinct days inside a cycle, up to today; weekly cycles skip Sunday like the planner.
    const pickDays = (cycle: VisitCycle, count: number, early: boolean) => {
      const last = cycle.end < today ? cycle.end : today;
      const span = daysBetween(cycle.start, last) + 1;
      const days = Array.from({ length: span }, (_, i) => addDaysKey(cycle.start, i)).filter((d) => interval > 7 || new Date(`${d}T00:00:00Z`).getUTCDay() !== 0);
      const pool = early ? days.slice(0, 2) : story.name === 'late-week' || story.name === 'procrastinator' ? days.slice(-3) : days;
      const chosen: string[] = [];
      while (chosen.length < Math.min(count, pool.length)) {
        const d = pool[Math.floor(r() * pool.length)];
        if (!chosen.includes(d)) chosen.push(d);
      }
      return chosen.sort();
    };

    let cycle = cycleContaining(today, interval);
    const cycles = interval > 7 ? 4 : 8;
    for (let age = 0; age < cycles; age++) {
      const count = story.visits(age, r) * (interval > 7 ? minimum : 1);
      const days = pickDays(cycle, count, story.name === 'early-bird' && age === 0);
      days.forEach((day, n) => {
        // Mostly the area's own Ops; ~1 in 5 visits done by a colleague (who never completes the owner's personal report).
        const visitor = peer !== owner && r() < 0.2 ? peer : owner;
        add(day, visitor, n);
      });
      cycle = previousCycle(cycle, interval);
    }
  }

  const existing = replace ? (await db.select({ id: storeVisits.id }).from(storeVisits).where(like(storeVisits.notes, `${MARKER_PREFIX}%`))).length : 0;
  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'preview', today, activeStores: storeRows.length, storesWithPolicy: storeRows.filter((r) => policyByCode.has(r.store.storeNo)).length,
    stories, visitsPlanned: visits.length, earlierDemoRowsToDelete: replace ? existing : 0,
    demoAccounts: demoUsers.map((u) => ({ nik: u.nik, area: areaNames.get(u.areaId), new: !allUsers.some((v) => v.id === u.id) })),
    note: replace ? 'Deletes only rows whose notes start with the demo marker, then inserts the new set. Real visits, users, policies and configuration are untouched.' : 'Insert-only, deterministic IDs. Existing visits, users/passwords, policies and configuration are preserved.',
  }, null, 2));
  if (!apply) return;
  const password = await hash('password123', 10);
  for (const user of demoUsers) {
    await db.insert(users).values({ ...user, password, roleId: role.id, employeeTypeId: type.id }).onConflictDoNothing();
  }
  if (replace) {
    const removed = await db.delete(storeVisits).where(like(storeVisits.notes, `${MARKER_PREFIX}%`)).returning({ id: storeVisits.id });
    console.log(`Removed ${removed.length} earlier demo visits.`);
  }
  let inserted = 0;
  for (let start = 0; start < visits.length; start += 100) {
    const saved = await db.insert(storeVisits).values(visits.slice(start, start + 100)).onConflictDoNothing().returning({ id: storeVisits.id });
    inserted += saved.length;
  }
  console.log(`Inserted ${inserted} demo visits; ${visits.length - inserted} already existed. New demo accounts use password123.`);
}

run().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => pool.end());
