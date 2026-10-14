import './lib/not-production';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, pool } from '@/lib/db';
import { storeVisits } from '@/lib/db/schema';
import { deleteFromStorage } from '@/lib/storage';
import type { VisitDetail, VisitTask, VisitStore, VisitPhotoGeo } from '@/lib/store-visit/types';

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
  check('HO cannot submit area checklist', (await ho(`/api/ops/store-visits/${outside.id}`, { method: 'POST' })).response.status, 403);

  const settings = await it('/api/ops/store-visits/config');
  check('45 imported policies available', (settings.body.policies as unknown[]).length >= 45, true);
  const invalidTask = await it('/api/ops/store-visits/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'tasks', tasks: [], version: 1 }) });
  check('Empty checklist rejected without changing configuration', invalidTask.response.status, 400);
  const store = mine.find((s) => s.hasCoordinates);
  assert.ok(store, 'Assigned test area needs an active store with coordinates.');
  const detailReply = await area(`/api/ops/store-visits/${store.id}`);
  const detail = detailReply.body as unknown as VisitDetail;
  const position = await pool.query<{ latitude: string; longitude: string }>('SELECT latitude,longitude FROM stores WHERE id = $1', [store.id]);
  const geo: VisitPhotoGeo = { lat: Number(position.rows[0].latitude), lng: Number(position.rows[0].longitude), accuracy: 10, capturedAt: new Date().toISOString() };
  const answers = Object.fromEntries(detail.tasks.map((t: VisitTask) => [t.id, { answer: 'ya', note: '' }]));
  const keys = ['store', ...detail.tasks.filter((t) => t.requirePhoto).map((t) => `task_${t.id}`)];
  const data = { id: testId, version: detail.version, geo, answers, photos: Object.fromEntries(keys.map((key) => [key, geo])), notes: marker };
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF1cAAAAASUVORK5CYII=', 'base64');
  function payload(overrides: Record<string, unknown> = {}, missingPhoto = false, invalidImage = false) {
    const form = new FormData(); form.set('data', JSON.stringify({ ...data, ...overrides }));
    if (!missingPhoto) keys.forEach((key) => form.set(key, new Blob([invalidImage ? Buffer.from('<html>invalid</html>') : png], { type: 'image/png' }), `${key}.png`));
    return form;
  }
  const submit = (body: FormData) => area(`/api/ops/store-visits/${store.id}`, { method: 'POST', body });
  check('Outside geofence rejected', (await submit(payload({ geo: { ...geo, lat: geo.lat + 1 } }))).response.status, 422);
  check('Coarse GPS rejected', (await submit(payload({ geo: { ...geo, accuracy: 1000 } }))).response.status, 422);
  check('Stale GPS rejected', (await submit(payload({ geo: { ...geo, capturedAt: '2020-01-01T00:00:00Z' } }))).response.status, 422);
  check('Outdated checklist rejected', (await submit(payload({ version: detail.version - 1 }))).response.status, 409);
  check('Missing checklist answers rejected', (await submit(payload({ answers: {} }))).response.status, 400);
  check('Missing photos rejected', (await submit(payload({}, true))).response.status, 400);
  check('Invalid image bytes rejected', (await submit(payload({}, false, true))).response.status, 400);
  check('Expired photo geotag rejected', (await submit(payload({ photos: Object.fromEntries(keys.map((key) => [key, { ...geo, capturedAt: '2020-01-01T00:00:00Z' }])) }))).response.status, 422);
  check('Outside-store photo geotag rejected', (await submit(payload({ photos: Object.fromEntries(keys.map((key) => [key, { ...geo, lat: geo.lat + 1 }])) }))).response.status, 422);
  const saved = await submit(payload());
  assert.equal(saved.body.success, true, `Valid submission failed: ${saved.body.error}`);
  check('Valid checklist, photos, and geotag submitted', saved.response.status, 201);
  check('Retry succeeds without duplicating a visit', (await submit(payload())).response.status, 200);
  const [record] = await db.select().from(storeVisits).where(eq(storeVisits.id, testId));
  check('Checklist snapshot preserved', record.tasks, detail.tasks);
  check('Geotag saved with store photo', record.photoGeo.lat, geo.lat);
  check('All task evidence saved', record.tasks.filter((t) => t.requirePhoto).every((t) => !!record.answers[t.id].photoUrl && !!record.answers[t.id].photoGeo), true);
  const history = (await area(`/api/ops/store-visits/${store.id}`)).body as unknown as VisitDetail;
  check('Submitted visit appears in history once', history.visits.filter((v) => v.id === testId).length, 1);
  check('No department code leaked to Ops', JSON.stringify(areaList.body).includes('deptCode'), false);
  console.log(`Passed ${checks} staging API checks.`);
}

async function cleanup() {
  const [record] = await db.select().from(storeVisits).where(eq(storeVisits.id, testId));
  if (record) {
    assert.equal(record.notes, marker, 'Refuse cleanup of an unrelated record.');
    const photos = [record.photoUrl, ...Object.values(record.answers).map((a) => a.photoUrl).filter((url): url is string => !!url)];
    await db.delete(storeVisits).where(eq(storeVisits.id, testId));
    await deleteFromStorage(photos);
    console.log('Removed only this test visit and its synthetic photos.');
  }
}
run().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => { try { await cleanup(); } finally { await pool.end(); } });
