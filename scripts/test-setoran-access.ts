// Runs against disposable fixtures in prism_local; never touches a remote DB.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { db, pool } from '@/lib/db';
import { areas, attendance, schedules, setoranMoneyStorage, setoranTasks, shifts, stores, taskDefinitions, userRoles, users, cekUangModalTasks } from '@/lib/db/schema';
import { addDaysKey, jakartaDayStart, jakartaTodayKey, jakartaWallClock } from '@/lib/day-bucket';
import { assertSetoranActor, autoSaveSetoran, getOrCreateSetoranForSchedule, getPriorUnpaidForStore, getSetoranForStoreDate, resolveSetoranActorSchedule, submitSetoran } from '@/lib/db/utils/setoran';
import { getTaskAccessStatus, materialiseTasksForSchedule } from '@/lib/db/utils/tasks';
import { taskRequiresLocation } from '@/lib/db/utils/task-location';
import { evaluateGeofence } from '@/lib/geo';
import { resolveCekUangModalActor, submitCekUangModal } from '@/lib/db/utils/cek-uang-modal';

const url = new URL(process.env.DATABASE_URL ?? '');
if (url.hostname !== '127.0.0.1' || url.pathname !== '/prism_local') throw new Error('Tests require prism_local on 127.0.0.1.');
const baseUrl = process.env.SETORAN_TEST_URL;
let storeId: number | undefined;
const ids = [randomUUID(), randomUUID()];
let settings: boolean | undefined;
let modalSettings: boolean | undefined;
let checks = 0;
const check = (label: string, value: unknown, expected: unknown) => { assert.deepEqual(value, expected, label); checks++; console.log(`PASS ${label}`); };

async function cleanupFixture(id: number) {
  // Loading the task-list endpoint materializes the other task types too.
  await pool.query('DELETE FROM cek_uang_modal_denominations WHERE task_id IN (SELECT id FROM cek_uang_modal_tasks WHERE store_id = $1)', [id]);
  await pool.query('DELETE FROM cek_bin_task_bins WHERE task_id IN (SELECT id FROM cek_bin_tasks WHERE store_id = $1)', [id]);
  for (const table of ['setoran_money_storage', 'setoran_tasks', 'store_opening_tasks', 'store_front_tasks', 'cek_bin_tasks', 'vm_checklist_tasks', 'marketing_check_tasks', 'briefing_tasks', 'store_closing_tasks', 'grooming_tasks', 'cek_uang_modal_tasks', 'serah_terima_tasks', 'attendance', 'schedules']) {
    await pool.query(`DELETE FROM ${table} WHERE store_id = $1`, [id]);
  }
  await db.delete(users).where(eq(users.homeStoreId, id));
  await db.delete(stores).where(eq(stores.id, id));
}

async function run() {
  if (process.argv.includes('--cleanup') || process.env.SETORAN_TEST_CLEANUP === '1') {
    const fixtures = await db.select().from(stores).where(eq(stores.name, 'Setoran regression fixture'));
    for (const fixture of fixtures) await cleanupFixture(fixture.id);
    console.log(`Cleaned ${fixtures.length} disposable fixture(s).`);
    return;
  }
  const [area] = await db.select().from(areas).limit(1);
  const [role] = await db.select().from(userRoles).where(eq(userRoles.code, 'employee'));
  const shiftRows = await db.select().from(shifts);
  const morning = shiftRows.find((row) => row.code === 'morning')!;
  const evening = shiftRows.find((row) => row.code === 'evening')!;
  const [definition] = await db.select().from(taskDefinitions).where(eq(taskDefinitions.code, 'setoran'));
  settings = definition.requiresLocation;
  const [modalDefinition] = await db.select().from(taskDefinitions).where(eq(taskDefinitions.code, 'cek_uang_modal'));
  modalSettings = modalDefinition.requiresLocation;
  const [store] = await db.insert(stores).values({ storeNo: `TEST-${randomUUID()}`, name: 'Setoran regression fixture', address: 'Local only', areaId: area.id, latitude: '-6.17', longitude: '106.75', geofenceRadiusM: '100' }).returning();
  storeId = store.id;
  const password = 'localRegression123';
  const hash = await bcrypt.hash(password, 10);
  await db.insert(users).values(ids.map((id, i) => ({ id, nik: id, name: `Setoran test ${i}`, password: hash, roleId: role.id, homeStoreId: store.id })));
  const today = jakartaTodayKey();
  const date = jakartaDayStart(today);
  const utcDate = new Date(`${today}T00:00:00Z`);
  const [creator, unchecked, checked, night] = await db.insert(schedules).values([
    { userId: ids[0], storeId: store.id, shiftId: morning.id, date },
    { userId: ids[1], storeId: store.id, shiftId: morning.id, date: utcDate },
    { userId: ids[1], storeId: store.id, shiftId: morning.id, date },
    { userId: ids[1], storeId: store.id, shiftId: evening.id, date },
  ]).returning();
  await db.insert(attendance).values({ scheduleId: checked.id, userId: ids[1], storeId: store.id, shiftId: morning.id, date: utcDate, status: 'late', checkInTime: jakartaWallClock(today, '09:00') });
  check('Creator without attendance stays blocked', await getTaskAccessStatus(creator.id, store.id, null, false), { status: 'not_checked_in' });
  check('Late attendance permits setoran without GPS', await getTaskAccessStatus(checked.id, store.id, null, false), { status: 'ok' });
  check('Location-required task needs a fix', await getTaskAccessStatus(checked.id, store.id, null, true), { status: 'geo_unavailable' });
  check('Duplicate opening schedules prefer the checked-in row', await resolveSetoranActorSchedule(ids[1], store.id, utcDate), checked.id);
  check('Acting user cannot borrow creator attendance', Boolean(await assertSetoranActor(creator.id, ids[1], store.id)), true);
  check('Evening shift cannot submit setoran', Boolean(await assertSetoranActor(night.id, ids[1], store.id)), true);

  // Existing seed encoding and application encoding must reuse one shared task.
  const [legacy] = await db.insert(setoranTasks).values({ scheduleId: creator.id, userId: ids[0], storeId: store.id, shiftId: morning.id, date: utcDate }).returning();
  const [modal] = await db.insert(cekUangModalTasks).values({ scheduleId: null, userId: ids[0], storeId: store.id, shiftId: morning.id, date: utcDate }).returning();
  const modalActor = await resolveCekUangModalActor(modal.id, ids[1]);
  check('Cek Uang Modal with deleted creator schedule resolves checked-in colleague', modalActor.success && modalActor.data.scheduleId, checked.id);
  check('Cek Uang Modal rejects unrelated employee', (await resolveCekUangModalActor(modal.id, randomUUID())).success, false);
  const [fullDaySchedule] = await db.insert(schedules).values({ userId: ids[0], storeId: store.id, shiftId: shiftRows.find((row) => row.code === 'full_day')!.id, date }).returning();
  await db.insert(attendance).values({ scheduleId: fullDaySchedule.id, userId: ids[0], storeId: store.id, shiftId: fullDaySchedule.shiftId, date, status: 'present', checkInTime: jakartaWallClock(today, '08:30') });
  const fullDayActor = await resolveCekUangModalActor(modal.id, ids[0]);
  check('Checked-in full-day employee can work the morning cash task', fullDayActor.success && fullDayActor.data.scheduleId, fullDaySchedule.id);
  await db.delete(attendance).where(eq(attendance.scheduleId, fullDaySchedule.id));
  const [jkpSchedule] = await db.insert(schedules).values({ userId: ids[0], storeId: store.id, shiftId: shiftRows.find((row) => row.code === 'jkp_morning')!.id, date: utcDate }).returning();
  await db.insert(attendance).values({ scheduleId: jkpSchedule.id, userId: ids[0], storeId: store.id, shiftId: jkpSchedule.shiftId, date: utcDate, status: 'present', checkInTime: jakartaWallClock(today, '08:30') });
  const jkpActor = await resolveCekUangModalActor(modal.id, ids[0]);
  check('JKP morning employee resolves to the shared morning cash task', jkpActor.success && jkpActor.data.scheduleId, jkpSchedule.id);
  const reused = await getOrCreateSetoranForSchedule(checked.id);
  check('Jakarta and UTC day buckets reuse the same task', reused.success && reused.data.id, legacy.id);
  check('Store/date lookup includes UTC seed encoding', (await getSetoranForStoreDate(store.id, date))?.id, legacy.id);
  await materialiseTasksForSchedule(checked.id);
  check('Schedule materialization reuses the existing day bucket', (await db.select().from(setoranTasks).where(eq(setoranTasks.storeId, store.id))).length, 1);
  check('Cek Uang Modal materialization reuses the detached UTC row', (await db.select().from(cekUangModalTasks).where(eq(cekUangModalTasks.storeId, store.id))).length, 1);
  check('Unchecked actor cannot autosave', (await autoSaveSetoran(unchecked.id, { notes: 'blocked' }, { userId: ids[1], scheduleId: unchecked.id })).success, false);
  check('Checked-in colleague can autosave shared task', (await autoSaveSetoran(checked.id, { notes: 'saved' }, { userId: ids[1], scheduleId: checked.id })).success, true);

  if (baseUrl) {
    const cookies = new Map<string, string>();
    const request = async (path: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      headers.set('Cookie', [...cookies].map(([key, value]) => `${key}=${value}`).join('; '));
      const response = await fetch(`${baseUrl}${path}`, { ...init, headers, redirect: 'manual', signal: AbortSignal.timeout(60_000) });
      for (const cookie of response.headers.getSetCookie()) {
        const [pair] = cookie.split(';'); const at = pair.indexOf('='); cookies.set(pair.slice(0, at), pair.slice(at + 1));
      }
      return { response, body: await response.json() };
    };
    const csrf = await request('/api/auth/csrf');
    await request('/api/auth/callback/credentials', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ csrfToken: csrf.body.csrfToken, nik: ids[1], password, json: 'true', callbackUrl: `${baseUrl}/employee` }) });
    const session = await request('/api/auth/session');
    check('Real credentials login against local DB', session.body.user?.id, ids[1]);
    await db.update(taskDefinitions).set({ requiresLocation: false }).where(eq(taskDefinitions.id, definition.id));
    const accessPath = `/api/employee/tasks/access?scheduleId=${creator.id}&storeId=${store.id}&taskType=setoran`;
    check('Access API checks colleague rather than shared creator', (await request(accessPath)).body.status, 'ok');
    const loaded = await request('/api/employee/tasks');
    check('Task-list API exposes today\'s shared setoran', loaded.body.tasks?.some((row: { type: string; data: { id: string } }) => row.type === 'setoran' && row.data.id === String(legacy.id)), true);
    const listedModal = loaded.body.tasks?.find((row: { type: string; data: { id: string } }) => row.type === 'cek_uang_modal' && row.data.id === String(modal.id));
    check('Task list supplies employee schedule for detached Cek Uang Modal', listedModal?.data.scheduleId, String(checked.id));
    check('Task list preserves null original schedule as history', listedModal?.data.originalScheduleId, null);
    const modalAccess = `/api/employee/tasks/access?taskType=cek_uang_modal&taskId=${modal.id}&scheduleId=null&storeId=${store.id}`;
    const modalPayload = { taskId: modal.id, scheduleId: null, denominations: [{ denominationValue: 100000, quantity: 2 }] };
    await db.update(taskDefinitions).set({ requiresLocation: true }).where(eq(taskDefinitions.id, modalDefinition.id));
    check('Cek Uang Modal access resolves null schedule and reports missing GPS', (await request(modalAccess)).body.status, 'geo_unavailable');
    const modalMissingGeo = await request('/api/employee/tasks/cek-uang-modal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...modalPayload, skipGeo: true }) });
    check('Cek Uang Modal cannot bypass IT location requirement', modalMissingGeo.response.status, 400);
    const modalOutside = await request('/api/employee/tasks/cek-uang-modal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...modalPayload, lat: -7, lng: 106.75 }) });
    check('Cek Uang Modal rejects outside-store location', modalOutside.body.success, false);
    await db.update(taskDefinitions).set({ requiresLocation: false }).where(eq(taskDefinitions.id, modalDefinition.id));
    check('Cek Uang Modal location-optional access reports ok', (await request(modalAccess)).body.status, 'ok');
    const modalDraft = await request('/api/employee/tasks/cek-uang-modal', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...modalPayload, notes: 'draft after deleted schedule' }) });
    check('Cek Uang Modal autosaves after creator schedule deletion', modalDraft.body.success, true);
    const modalSubmitted = await request('/api/employee/tasks/cek-uang-modal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(modalPayload) });
    assert.equal(modalSubmitted.body.success, true, `Screenshot payload submission: ${modalSubmitted.body.error ?? 'failed'}`);
    check('Screenshot payload with scheduleId:null now submits successfully', modalSubmitted.body.success, true);
    check('Cek Uang Modal submission uses logged-in checked-in schedule', modalSubmitted.body.data?.task.scheduleId, checked.id);
    const malformedModal = await request('/api/employee/tasks/cek-uang-modal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: 'invalid', scheduleId: null }) });
    check('Invalid Cek Uang Modal IDs return a client error rather than 500', malformedModal.response.status, 400);
    const autosave = await request('/api/employee/tasks/setoran', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: legacy.id, notes: 'API saved' }) });
    check('Autosave API resolves checked-in duplicate', autosave.body.success, true);
    check('Autosave records actual field actor', (await db.select().from(setoranTasks).where(eq(setoranTasks.id, legacy.id)))[0].notesBy, ids[1]);
    const forbidden = await request('/api/employee/tasks/setoran', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scheduleId: creator.id, notes: 'forged' }) });
    check('Schedule-only requests cannot edit another employee\'s task', forbidden.response.status, 403);
    await db.update(taskDefinitions).set({ requiresLocation: true }).where(eq(taskDefinitions.id, definition.id));
    check('IT can enable location validation', await taskRequiresLocation('setoran'), true);
    check('Missing GPS reflects the live IT setting', (await request(accessPath)).body.status, 'geo_unavailable');
    const payload = { taskId: legacy.id, actualReceivedAmount: '0', storedAmount: '0', cashierPhoto: 'test/cash.jpg', atmCardPhoto: 'test/atm.jpg' };
    const missingGeo = await request('/api/employee/tasks/setoran', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    check('Submit API enforces location when enabled', missingGeo.body.success, false);
    const outside = await request('/api/employee/tasks/setoran', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, geo: { lat: -7, lng: 106.75, accuracy: 5 } }) });
    check('Submit API rejects outside-store fix', outside.body.success, false);
    const inside = await request('/api/employee/tasks/setoran', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, geo: { lat: -6.17, lng: 106.75, accuracy: 10 } }) });
    check('Submit API accepts valid colleague attendance and location', inside.body.success, true);
    check('Submission records the checked-in actor schedule', inside.body.data?.completedByScheduleId, checked.id);
  } else {
    const modalSubmitted = await submitCekUangModal({ taskId: modal.id, scheduleId: creator.id, userId: ids[1], storeId: store.id, geo: { lat: -6.17, lng: 106.75 }, denominations: [{ denominationValue: 100000, quantity: 2 }] });
    check('Cek Uang Modal utility resolves actor despite stale creator schedule', modalSubmitted.success && modalSubmitted.data.task.scheduleId, checked.id);
    const submitted = await submitSetoran({ scheduleId: checked.id, userId: ids[1], storeId: store.id, actualReceivedAmount: '0', storedAmount: '0', resiPhoto: '', atmCardSelfiePhoto: '', cashierPhoto: 'test/cash.jpg', atmCardPhoto: 'test/atm.jpg' });
    check('Checked-in colleague can submit creator\'s shared task', submitted.success, true);
  }
  const yesterday = addDaysKey(today, -1);
  const [prior] = await db.insert(setoranTasks).values({ scheduleId: creator.id, userId: ids[0], storeId: store.id, shiftId: morning.id, date: new Date(`${yesterday}T00:00:00Z`), status: 'completed' }).returning();
  await db.insert(setoranMoneyStorage).values({ taskId: prior.id, userId: ids[0], scheduleId: creator.id, storeId: store.id, shiftId: morning.id, date: prior.date, actualReceivedAmount: '100', previousUnpaidAmount: '0', requiredStoreAmount: '100', storedAmount: '0', unpaidAmount: '100' });
  check('Carry-forward excludes today regardless of host timezone', await getPriorUnpaidForStore(store.id, date), '100.00');
  const tomorrow = addDaysKey(today, 1);
  const concurrentSchedules = await db.insert(schedules).values(ids.map((userId) => ({ userId, storeId: store.id, shiftId: morning.id, date: jakartaDayStart(tomorrow) }))).returning();
  const concurrent = await Promise.all(concurrentSchedules.map((schedule) => getOrCreateSetoranForSchedule(schedule.id)));
  check('Concurrent employees can open setoran without a uniqueness failure', concurrent.every((result) => result.success), true);
  check('Concurrent creation returns one shared task', new Set(concurrent.map((result) => result.success && result.data.id)).size, 1);
  check('GPS uncertainty allowance accepts nearby indoor fix', evaluateGeofence({ lat: -6.169, lng: 106.75, accuracy: 20 }, { lat: -6.17, lng: 106.75, radiusM: 100 }).inside, true);
  check('Large GPS uncertainty does not accept distant fix', evaluateGeofence({ lat: -6.16, lng: 106.75, accuracy: 2000 }, { lat: -6.17, lng: 106.75, radiusM: 100 }).inside, false);
  console.log(`${checks} checks passed (TZ=${process.env.TZ ?? 'host'}).`);
}

run().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (settings !== undefined) await db.update(taskDefinitions).set({ requiresLocation: settings }).where(eq(taskDefinitions.code, 'setoran'));
  if (modalSettings !== undefined) await db.update(taskDefinitions).set({ requiresLocation: modalSettings }).where(eq(taskDefinitions.code, 'cek_uang_modal'));
  try {
    if (storeId) await cleanupFixture(storeId);
  } finally {
    await pool.end();
  }
});
