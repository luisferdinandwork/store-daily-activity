// Read-only staging integration checks against the running local dev server.
import './lib/not-production';
import assert from 'node:assert/strict';
import { pool } from '@/lib/db';
import { jakartaDateKey } from '@/lib/day-bucket';
import { calendarWeeks, type VisitReport } from '@/lib/store-visit/report';

const base = process.env.VISIT_TEST_URL ?? 'http://localhost:3000';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Tests must target the local server.');
let checks = 0;
function check(label: string, actual: unknown, expected: unknown) {
  assert.deepEqual(actual, expected, label); checks++; console.log(`PASS ${label}`);
}
async function client(nik: string) {
  const cookies = new Map<string, string>();
  async function request(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    headers.set('Cookie', [...cookies].map(([key, value]) => `${key}=${value}`).join('; '));
    headers.set('Origin', base);
    const response = await fetch(`${base}${path}`, { ...init, headers, redirect: 'manual' });
    for (const cookie of response.headers.getSetCookie()) {
      const first = cookie.split(';')[0]; const i = first.indexOf('=');
      cookies.set(first.slice(0, i), first.slice(i + 1));
    }
    assert.ok(response.headers.get('content-type')?.includes('application/json'), `Expected API JSON for ${path} (${response.status}).`);
    return { response, body: await response.json() };
  }
  const csrf = await request('/api/auth/csrf');
  await request('/api/auth/callback/credentials', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ csrfToken: csrf.body.csrfToken, nik, password: process.env.VISIT_TEST_PASSWORD ?? 'password123', json: 'true' }).toString() });
  const session = await request('/api/auth/session');
  assert.ok(session.body.user?.id, `Login failed: ${nik}`);
  return { request, user: session.body.user as { id: string; areaId: number | null } };
}
type DbVisit = { id: string; store_id: number; visited_by: string; visited_at: Date; area_id: number };

async function run() {
  check('Anonymous report denied', (await fetch(`${base}/api/ops/store-visits/report`)).status, 401);
  const visits = (await pool.query<DbVisit>('select v.id,v.store_id,v.visited_by,v.visited_at,s.area_id from store_visits v join stores s on s.id=v.store_id where s.status=\'active\'')).rows;
  const stores = (await pool.query<{ id: number; area_id: number }>("select id,area_id from stores where status='active'")).rows;
  const area = await client('VISIT-DEMO-AREA-1');
  const colleague = await client(process.env.VISIT_TEST_AREA_NIK ?? 'A11040401');
  const otherArea = await client('VISIT-DEMO-AREA-6');
  const ho = await client(process.env.VISIT_TEST_HO_NIK ?? 'OPS-HO-001');
  const it = await client(process.env.VISIT_TEST_IT_NIK ?? 'IT-001');
  let allReport: VisitReport | undefined;
  for (const [label, actor, full] of [['Area demo', area, false], ['Same-area colleague', colleague, false], ['Other area', otherArea, false], ['HO', ho, true], ['IT', it, true]] as const) {
    const reply = await actor.request('/api/ops/store-visits/report?month=2026-10');
    check(`${label}: report loads`, [reply.response.status, reply.body.success], [200, true]);
    const report = reply.body as VisitReport;
    const allowedStores = stores.filter((s) => full || s.area_id === actor.user.areaId);
    const allowedIds = new Set(allowedStores.map((s) => s.id));
    const allowed = visits.filter((v) => allowedIds.has(v.store_id) && (full || v.visited_by === actor.user.id));
    check(`${label}: store scope`, report.stores.map((s) => s.id).sort(), allowedStores.map((s) => s.id).sort());
    const weeks = calendarWeeks(report.month);
    const expectedCalendar = allowed.filter((v) => {
      const day = jakartaDateKey(v.visited_at); return day >= weeks[0][0] && day <= weeks[weeks.length - 1][6];
    });
    check(`${label}: exact calendar scope`, report.calendarVisits.map((v) => v.id).sort(), expectedCalendar.map((v) => v.id).sort());
    if (!full) {
      check(`${label}: only own activity/name exposed`, report.ops.map((o) => o.id), [actor.user.id]);
      check(`${label}: only own area exposed`, report.areas.map((a) => a.id), [actor.user.areaId]);
      check(`${label}: only own store assignments exposed`, report.stores.every((s) => s.opsNames.length === 1 && s.opsNames[0] === report.ops[0].name), true);
    } else {
      check(`${label}: all active areas exposed`, report.areas.length, new Set(stores.map((s) => s.area_id)).size);
    }
    for (const store of report.stores) {
      const own = allowed.filter((v) => v.store_id === store.id && jakartaDateKey(v.visited_at) <= report.today);
      const latest = [...own].sort((a, b) => b.visited_at.getTime() - a.visited_at.getTime())[0];
      assert.equal(store.lastVisit?.id ?? null, latest?.id ?? null, `${label}: latest visit for ${store.storeNo}`);
      if (store.cycle) {
        const current = own.filter((v) => { const day = jakartaDateKey(v.visited_at); return day >= store.cycle!.start && day <= store.cycle!.end; });
        assert.equal(store.cycle.count, new Set(current.map((v) => jakartaDateKey(v.visited_at))).size, `${label}: distinct days for ${store.storeNo}`);
        assert.deepEqual(store.visits.map((v) => v.id).sort(), current.map((v) => v.id).sort(), `${label}: current visits for ${store.storeNo}`);
        for (const cycle of store.history) {
          const days = new Set(own.map((v) => jakartaDateKey(v.visited_at)).filter((day) => day >= cycle.start && day <= cycle.end));
          assert.equal(cycle.count, days.size, `${label}: historical count for ${store.storeNo}`);
        }
      }
    }
    checks++; console.log(`PASS ${label}: last visit, current-cycle records, distinct-day counts and all history match authorized DB rows`);
    if (label === 'HO') allReport = report;
  }
  assert.ok(allReport);
  const peerVisit = visits.find((v) => v.area_id === area.user.areaId && v.visited_by === colleague.user.id);
  assert.ok(peerVisit && visits.some((v) => v.visited_by === area.user.id), 'Same-area isolation fixtures required.');
  const personal = (await area.request('/api/ops/store-visits/report?month=2026-10&areaId=6&visitedBy=OPS-HO-001')).body as VisitReport;
  check('Query parameters cannot expand personal scope', personal.calendarVisits.every((v) => v.byId === area.user.id), true);
  check('Query parameters cannot expand area scope', personal.stores.every((s) => s.areaId === area.user.areaId), true);
  const detail = await area.request(`/api/ops/store-visits/${peerVisit.store_id}`);
  check('Area store history hides colleague evidence', detail.body.visits.every((v: { visitedBy: string }) => v.visitedBy === area.user.id), true);
  const hoDetail = await ho.request(`/api/ops/store-visits/${peerVisit.store_id}`);
  check('HO store history includes colleague evidence', hoDetail.body.visits.some((v: { visitedBy: string }) => v.visitedBy === colleague.user.id), true);
  const outside = stores.find((s) => s.area_id !== area.user.areaId)!;
  check('Outside-area detail denied', (await area.request(`/api/ops/store-visits/${outside.id}`)).response.status, 403);
  check('Invalid calendar month rejected', (await area.request('/api/ops/store-visits/report?month=2026-13')).response.status, 400);
  console.log(`Passed ${checks} read-only report API checks.`);
}

run().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => pool.end());
