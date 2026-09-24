// scripts/seed/user-demo.ts
// ─────────────────────────────────────────────────────────────────────────────
// Register ONE employee in a store and give them demo data for the current
// month — for a late addition to a store that may already have real data (the
// store-wide roster-demo / roster-demo-performance steps skip such stores).
//
//   USER_DEMO_NIK=A202504065 USER_DEMO_NAME="Aura Diya Salsabila" USER_DEMO_STORE=FF014 \
//     npx dotenv -e .env.local -- tsx scripts/seed/user-demo.ts
//   USER_DEMO_TYPE=pic_1|pic_2|sa   (default sa — only used when creating the user)
//   USER_DEMO_DRY=1                 (plan only, no writes)
//
// Steps (each is skipped if already done, so re-running is safe):
//   1. user      — created as an employee with password `password123` if the
//                  NIK doesn't exist; an existing user in another store aborts.
//   2. schedule  — the whole month (monthly_schedules is reused if the store
//                  already has one) + materialised working days. Schedule only:
//                  no attendance/task history.
//   3. target    — store already has this month's target → the user joins its
//                  roster (0%, headcount template) and percentages are re-synced;
//                  no target yet → a dummy store target for the whole roster,
//                  same as roster-demo-performance.
// FF001/FO001 are refused.
// ─────────────────────────────────────────────────────────────────────────────

import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: '.env' });

import { and, eq, isNotNull } from 'drizzle-orm';
import bcrypt from 'bcryptjs';

import { db } from '@/lib/db';
import {
  employeeMonthlyTargets, employeeTypes, monthlyScheduleEntries, monthlySchedules,
  schedules, shifts, storeMonthlyTargets, stores, userRoles, users,
} from '@/lib/db/schema';
import { setUserHomeStore } from '@/lib/db/utils/user-store-assignment';
import { syncRosterPercentages } from '@/lib/performance/target-utils';
import { CAL, CODE_TO_SHIFT, PROTECTED_STORE_NOS, buildGrid, makeRng } from './roster-demo';
import { ROLE_BY_TYPE, planStore, writeStore, type Candidate } from './roster-demo-performance';

const NIK = process.env.USER_DEMO_NIK?.trim() ?? '';
const NAME = process.env.USER_DEMO_NAME?.trim() ?? '';
const STORE_NO = process.env.USER_DEMO_STORE?.trim().toUpperCase() ?? '';
const TYPE = process.env.USER_DEMO_TYPE?.trim() || 'sa';
const DRY = process.env.USER_DEMO_DRY === '1';
const DEFAULT_PASSWORD = 'password123';

const dayBucket = (day: number) => new Date(Date.UTC(CAL.year, CAL.monthIndex, day));

async function main() {
  if (!NIK || !STORE_NO) throw new Error('USER_DEMO_NIK and USER_DEMO_STORE are required.');
  if (PROTECTED_STORE_NOS.has(STORE_NO)) throw new Error(`Refusing to touch protected store ${STORE_NO}.`);
  console.log(`\n👤 user-demo ${DRY ? '(DRY RUN — nothing is written)' : ''}: ${NIK} → ${STORE_NO}, ${CAL.yearMonth}`);

  const [store] = await db.select({ id: stores.id, storeNo: stores.storeNo, name: stores.name, areaId: stores.areaId })
    .from(stores).where(eq(stores.storeNo, STORE_NO)).limit(1);
  if (!store) throw new Error(`Store ${STORE_NO} not found.`);
  console.log(`   store: ${store.storeNo} – ${store.name} (id ${store.id})`);

  // ── 1. user ────────────────────────────────────────────────────────────────
  let [user] = await db.select({ id: users.id, nik: users.nik, name: users.name, homeStoreId: users.homeStoreId, employeeTypeId: users.employeeTypeId })
    .from(users).where(eq(users.nik, NIK)).limit(1);
  if (user) {
    if (user.homeStoreId !== store.id) throw new Error(`${NIK} (${user.name}) already exists with home store id ${user.homeStoreId}, not ${STORE_NO}. Move them first.`);
    console.log(`   user: exists — ${user.name} (${user.id})`);
  } else {
    if (!NAME) throw new Error('USER_DEMO_NAME is required to create a new user.');
    const [role] = await db.select({ id: userRoles.id }).from(userRoles).where(eq(userRoles.code, 'employee')).limit(1);
    const [empType] = await db.select({ id: employeeTypes.id }).from(employeeTypes).where(eq(employeeTypes.code, TYPE)).limit(1);
    if (!role || !empType) throw new Error(`Role "employee" or employee type "${TYPE}" not found.`);
    if (DRY) {
      console.log(`   user: would create ${NIK} – ${NAME} (employee / ${TYPE}), password ${DEFAULT_PASSWORD}`);
      user = { id: 'dry-run', nik: NIK, name: NAME, homeStoreId: store.id, employeeTypeId: empType.id };
    } else {
      const [created] = await db.insert(users).values({
        nik: NIK, name: NAME, password: await bcrypt.hash(DEFAULT_PASSWORD, 10),
        roleId: role.id, employeeTypeId: empType.id, homeStoreId: store.id, areaId: store.areaId, isActive: true,
      }).returning({ id: users.id });
      await setUserHomeStore({
        userId: created.id, homeStoreId: store.id, areaId: store.areaId, roleId: role.id, employeeTypeId: empType.id,
        assignedBy: null, notes: 'Created by scripts/seed/user-demo.ts.',
      });
      user = { id: created.id, nik: NIK, name: NAME, homeStoreId: store.id, employeeTypeId: empType.id };
      console.log(`   user: created ${NIK} – ${NAME} (employee / ${TYPE}), password ${DEFAULT_PASSWORD}`);
    }
  }

  // ── 2. schedule ────────────────────────────────────────────────────────────
  const shiftRows = await db.select({ id: shifts.id, code: shifts.code }).from(shifts);
  const shiftId = (code: string) => {
    const s = shiftRows.find((r) => r.code === code);
    if (!s) throw new Error(`Shift "${code}" missing.`);
    return s.id;
  };

  let [master] = await db.select({ id: monthlySchedules.id }).from(monthlySchedules)
    .where(and(eq(monthlySchedules.storeId, store.id), eq(monthlySchedules.yearMonth, CAL.yearMonth))).limit(1);
  const existingEntries = master
    ? await db.select({ id: monthlyScheduleEntries.id }).from(monthlyScheduleEntries)
      .where(and(eq(monthlyScheduleEntries.monthlyScheduleId, master.id), eq(monthlyScheduleEntries.userId, user.id))).limit(1)
    : [];

  if (existingEntries.length) {
    console.log('   schedule: already has entries this month — skipped');
  } else {
    const codes = buildGrid(makeRng(`user-demo|${CAL.yearMonth}|${STORE_NO}|${NIK}`));
    const summary = { work: codes.filter((c) => c === 'E' || c === 'L' || c === 'F').length, off: codes.filter((c) => c === 'X').length, leave: codes.filter((c) => c === 'A').length };
    if (DRY) {
      console.log(`   schedule: would write ${codes.length} days (${summary.work} work / ${summary.off} off / ${summary.leave} leave) — ${codes.join('')}${master ? ' into the existing monthly schedule' : ' + a new monthly schedule'}`);
    } else {
      if (!master) {
        [master] = await db.insert(monthlySchedules).values({
          storeId: store.id, yearMonth: CAL.yearMonth, importedBy: user.id, note: 'Dummy schedule (scripts/seed/user-demo.ts).',
        }).onConflictDoNothing().returning({ id: monthlySchedules.id });
        if (!master) {
          [master] = await db.select({ id: monthlySchedules.id }).from(monthlySchedules)
            .where(and(eq(monthlySchedules.storeId, store.id), eq(monthlySchedules.yearMonth, CAL.yearMonth))).limit(1);
        }
      }
      const entries = await db.insert(monthlyScheduleEntries).values(codes.map((code, i) => {
        const work = code === 'E' || code === 'L' || code === 'F';
        return {
          monthlyScheduleId: master.id, userId: user.id, storeId: store.id, date: dayBucket(i + 1),
          shiftId: work ? shiftId(CODE_TO_SHIFT[code]) : null, isOff: code === 'X', isLeave: code === 'A',
        };
      })).onConflictDoNothing().returning({ id: monthlyScheduleEntries.id, date: monthlyScheduleEntries.date, shiftId: monthlyScheduleEntries.shiftId });
      const scheduleRows = entries.filter((e) => e.shiftId != null).map((e) => ({
        userId: user.id, storeId: store.id, shiftId: e.shiftId!, date: e.date, monthlyScheduleEntryId: e.id, isHoliday: false,
      }));
      if (scheduleRows.length) await db.insert(schedules).values(scheduleRows);
      console.log(`   schedule: wrote ${entries.length} days (${summary.work} work / ${summary.off} off / ${summary.leave} leave) — ${codes.join('')}`);
    }
  }

  // ── 3. performance target ──────────────────────────────────────────────────
  const [storeTarget] = await db.select({ id: storeMonthlyTargets.id }).from(storeMonthlyTargets)
    .where(and(eq(storeMonthlyTargets.storeId, store.id), eq(storeMonthlyTargets.yearMonth, CAL.yearMonth))).limit(1);
  const [typeRow] = user.employeeTypeId
    ? await db.select({ code: employeeTypes.code }).from(employeeTypes).where(eq(employeeTypes.id, user.employeeTypeId)).limit(1)
    : [];
  const roleCode = typeRow ? ROLE_BY_TYPE[typeRow.code] : undefined;
  if (!roleCode) {
    console.log('   target: user has no pic_1/pic_2/sa employee type — skipped');
  } else if (storeTarget) {
    const roster = await db.select({ userId: employeeMonthlyTargets.userId, role: employeeMonthlyTargets.targetRoleCode, sortOrder: employeeMonthlyTargets.sortOrder })
      .from(employeeMonthlyTargets)
      .where(and(eq(employeeMonthlyTargets.storeId, store.id), eq(employeeMonthlyTargets.yearMonth, CAL.yearMonth)));
    if (roster.some((r) => r.userId === user.id)) {
      console.log('   target: already on this month\'s roster — skipped');
    } else if (DRY) {
      console.log(`   target: would join the existing store target as ${roleCode} and re-sync percentages`);
    } else {
      const nextSa = Math.max(0, ...roster.filter((r) => r.role === 'SA').map((r) => r.sortOrder ?? 0)) + 1;
      await db.insert(employeeMonthlyTargets).values({
        storeMonthlyTargetId: storeTarget.id, userId: user.id, storeId: store.id, yearMonth: CAL.yearMonth,
        targetRoleCode: roleCode, sortOrder: roleCode === 'SA' ? nextSa : 0, percentage: '0.00',
        isPercentageOverridden: false, notes: 'Added by scripts/seed/user-demo.ts.', isActive: true,
      }).onConflictDoNothing();
      await syncRosterPercentages({ storeId: store.id, yearMonth: CAL.yearMonth });
      console.log(`   target: joined the existing store target as ${roleCode}; percentages re-synced`);
    }
  } else {
    const staff = await db
      .select({ id: users.id, nik: users.nik, name: users.name, typeCode: employeeTypes.code })
      .from(users)
      .innerJoin(userRoles, eq(userRoles.id, users.roleId))
      .leftJoin(employeeTypes, eq(employeeTypes.id, users.employeeTypeId))
      .where(and(eq(userRoles.code, 'employee'), eq(users.isActive, true), isNotNull(users.homeStoreId), eq(users.homeStoreId, store.id)));
    const employees = staff.filter((e) => e.typeCode && ROLE_BY_TYPE[e.typeCode]).map((e) => ({ id: e.id, nik: e.nik, name: e.name, role: ROLE_BY_TYPE[e.typeCode!] }));
    if (!employees.some((e) => e.id === user.id)) employees.push({ id: user.id, nik: user.nik, name: user.name, role: roleCode });
    const candidate: Candidate = { store, employees };
    const plan = await planStore(candidate);
    const rp = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;
    if (!DRY) await writeStore(candidate, plan);
    console.log(`   target: ${DRY ? 'would create' : 'created'} store target ${rp(plan.salesTarget)} · ${plan.transactionTarget} trx for ${employees.length} employee(s) [${plan.basis}]`);
  }

  console.log('\n✅ user-demo complete.');
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('\n✗ user-demo failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
