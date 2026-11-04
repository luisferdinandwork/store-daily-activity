import './lib/not-production';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, pool } from '@/lib/db';
import { storeVisits } from '@/lib/db/schema';
import { deleteFromStorage } from '@/lib/storage';
import { VISIT_FIELDS, VISIT_FIELD_MAX, VISIT_FIELD_TASKS } from '@/lib/store-visit/fields';
import type { VisitDetail, VisitResult, VisitStore, VisitPhotoGeo } from '@/lib/store-visit/types';

const base = process.env.VISIT_TEST_URL || 'http://localhost:3000';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'API test must target a local dev server.');
const testId = randomUUID();
const marker = 'Automated store visit staging test';
let checks = 0;
const check = (label: string, actual: unknown, expected: unknown) => {
  assert.deepEqual(actual, expected, label); checks++; console.log(`PASS ${label}`);
};
type Reply = { response: Response; body: Record<string, unknown> };

async function client(nik: string) {
  const cookies = new Map<string, string>();
  async function request(path: string, init: RequestInit = {}): Promise<Reply> {
    const headers = new Headers(init.headers);
    headers.set('Cookie', [...cookies].map(([key, value]) => `${key}=${value}`).join('; '));
    headers.set('Origin', base);
    const response = await fetch(`${base}${path}`, { ...init, headers, redirect: 'manual' });
    for (const cookie of response.headers.getSetCookie()) {
      const first = cookie.split(';')[0]; const at = first.indexOf('=');
      cookies.set(first.slice(0, at), first.slice(at + 1));
    }
    const body = await response.json() as Record<string, unknown>;
    return { response, body };
  }
  const csrf = await request('/api/auth/csrf');
  await request('/api/auth/callback/credentials', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ csrfToken: String(csrf.body.csrfToken), nik, password: process.env.VISIT_TEST_PASSWORD || 'password123', json: 'true' }).toString() });
  const session = await request('/api/auth/session');
  assert.ok((session.body.user as { id?: string } | undefined)?.id, `Test login failed for ${nik}; set VISIT_TEST_PASSWORD to the staging test account password.`);
  return request;
}

async function run() {
  const anon = await fetch(`${base}/api/ops/store-visits`, { redirect: 'manual' });
  check('Signed-out API denied', anon.status, 401);
  const it = await client(process.env.VISIT_TEST_IT_NIK || 'IT-001');
  const ho = await client(process.env.VISIT_TEST_HO_NIK || 'OPS-HO-001');
  const area = await client(process.env.VISIT_TEST_AREA_NIK || 'OPS-DUMMY-001');
  const itList = await it('/api/ops/store-visits');
  check('IT can load all stores', itList.body.success, true);
  const areaList = await area('/api/ops/store-visits');
  check('Area Ops can load assigned stores', areaList.body.success, true);
  const mine = areaList.body.stores as VisitStore[];
  const all = itList.body.stores as VisitStore[];
  assert.ok(mine.length && all.length > mine.length, 'Need two store areas for access checks.');
  const outside = all.find((s) => !mine.some((m) => m.id === s.id))!;
  check('Other area store cannot be read', (await area(`/api/ops/store-visits/${outside.id}`)).response.status, 403);
  check('Other area store cannot be submitted', (await area(`/api/ops/store-visits/${outside.id}`, { method: 'POST' })).response.status, 403);
  check('Area Ops cannot read IT settings', (await area('/api/ops/store-visits/config')).response.status, 403);
  check('HO cannot edit IT settings', (await ho('/api/ops/store-visits/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}' })).response.status, 403);
  check('HO monitors visits', (await ho(`/api/ops/store-visits/${outside.id}`)).body.success, true);
  check('HO cannot submit an area visit', (await ho(`/api/ops/store-visits/${outside.id}`, { method: 'POST' })).response.status, 403);

  const settings = await it('/api/ops/store-visits/config');
  check('45 imported policies available', (settings.body.policies as unknown[]).length >= 45, true);
  const invalidTask = await it('/api/ops/store-visits/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'tasks', tasks: [], version: 1 }) });
  check('Old checklist edits are no longer accepted', invalidTask.response.status >= 400, true);
  const store = mine.find((s) => s.hasCoordinates);
  assert.ok(store, 'Assigned test area needs an active store with coordinates.');
  const detailReply = await area(`/api/ops/store-visits/${store.id}`);
  const detail = detailReply.body as unknown as VisitDetail;
  check('Form data carries no visit history', 'visits' in detailReply.body, false);
  check('Form data says Ops Area can submit', detail.canSubmit, true);
  const position = await pool.query<{ latitude: string; longitude: string }>('SELECT latitude,longitude FROM stores WHERE id = $1', [store.id]);
  const geo: VisitPhotoGeo = { lat: Number(position.rows[0].latitude), lng: Number(position.rows[0].longitude), accuracy: 10, capturedAt: new Date().toISOString() };
  const fields = Object.fromEntries(VISIT_FIELDS.map((f) => [f.id, `Isian ${f.label} (${marker})`]));
  const data = { id: testId, geo, fields, photos: { store: geo } };
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF1cAAAAASUVORK5CYII=', 'base64');
  function payload(overrides: Record<string, unknown> = {}, missingPhoto = false, invalidImage = false) {
    const form = new FormData(); form.set('data', JSON.stringify({ ...data, ...overrides }));
    if (!missingPhoto) form.set('store', new Blob([invalidImage ? Buffer.from('<html>invalid</html>') : png], { type: 'image/png' }), 'store.png');
    return form;
  }
  const submit = (body: FormData) => area(`/api/ops/store-visits/${store.id}`, { method: 'POST', body });
  check('Outside geofence rejected', (await submit(payload({ geo: { ...geo, lat: geo.lat + 1 } }))).response.status, 422);
  check('Coarse GPS rejected', (await submit(payload({ geo: { ...geo, accuracy: 1000 } }))).response.status, 422);
  check('Stale GPS rejected', (await submit(payload({ geo: { ...geo, capturedAt: '2020-01-01T00:00:00Z' } }))).response.status, 422);
  check('Missing text fields rejected', (await submit(payload({ fields: {} }))).response.status, 400);
  check('One empty text field rejected', (await submit(payload({ fields: { ...fields, vm: '   ' } }))).response.status, 400);
  check('Over-long text rejected', (await submit(payload({ fields: { ...fields, human: 'x'.repeat(VISIT_FIELD_MAX + 1) } }))).response.status, 400);
  check('Missing store photo rejected', (await submit(payload({}, true))).response.status, 400);
  check('Invalid image bytes rejected', (await submit(payload({}, false, true))).response.status, 400);
  check('Expired photo geotag rejected', (await submit(payload({ photos: { store: { ...geo, capturedAt: '2020-01-01T00:00:00Z' } } }))).response.status, 422);
  check('Outside-store photo geotag rejected', (await submit(payload({ photos: { store: { ...geo, lat: geo.lat + 1 } } }))).response.status, 422);
  const saved = await submit(payload());
  assert.equal(saved.body.success, true, `Valid submission failed: ${saved.body.error}`);
  check('Valid text report, photo, and geotag submitted', saved.response.status, 201);
  check('Retry succeeds without duplicating a visit', (await submit(payload())).response.status, 200);
  const [record] = await db.select().from(storeVisits).where(eq(storeVisits.id, testId));
  check('Fixed text fields snapshot preserved', record.tasks, VISIT_FIELD_TASKS);
  check('Each text saved as a text answer', VISIT_FIELDS.every((f) => record.answers[f.id]?.answer === 'text' && record.answers[f.id].note === fields[f.id]), true);
  check('Geotag saved with store photo', record.photoGeo.lat, geo.lat);

  // The result is read from its own endpoint (the Report's preview), never from the form.
  const result = await area(`/api/ops/store-visits/result/${testId}`);
  check('Own visit result readable', result.response.status, 200);
  const shown = result.body.visit as VisitResult;
  check('Result carries the three texts', VISIT_FIELDS.every((f) => shown.answers[f.id]?.note === fields[f.id]), true);
  check('Result names the store', shown.storeNo, store.storeNo);
  check('HO can read any visit result', (await ho(`/api/ops/store-visits/result/${testId}`)).response.status, 200);
  check('Unknown visit result is 404', (await area(`/api/ops/store-visits/result/${randomUUID()}`)).response.status, 404);
  check('Malformed visit id rejected', (await area('/api/ops/store-visits/result/not-a-uuid')).response.status, 400);
  check('No department code leaked to Ops', JSON.stringify(areaList.body).includes('deptCode'), false);
  console.log(`Passed ${checks} staging API checks.`);
}

async function cleanup() {
  const [record] = await db.select().from(storeVisits).where(eq(storeVisits.id, testId));
  if (record) {
    assert.ok(Object.values(record.answers).every((a) => a.note.includes(marker)), 'Refuse cleanup of an unrelated record.');
    const photos = [record.photoUrl, ...Object.values(record.answers).map((a) => a.photoUrl).filter((url): url is string => !!url)];
    await db.delete(storeVisits).where(eq(storeVisits.id, testId));
    await deleteFromStorage(photos);
    console.log('Removed only this test visit and its synthetic photos.');
  }
}
run().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => { try { await cleanup(); } finally { await pool.end(); } });
