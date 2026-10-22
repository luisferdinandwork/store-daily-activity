import assert from 'node:assert/strict';
import { visitProgress, validateVisitPolicy, validateVisitTasks } from '../lib/store-visit/rules';
import { cycleContaining, cycleRangeLabel, visitCycleView } from '../lib/store-visit/cycles';
import { attentionOrder, buildReportStore, calendarWeeks, missedLastCycle, missedStreak, reportState, reportTotals, weekCoverage } from '../lib/store-visit/report';
import { parseGeoPoint, evaluateGeofence } from '../lib/geo';
import { isOpsMobileReady } from '../lib/ops-mobile';
import source from '../lib/store-visit/schedule-source.json';

const policy = { storeNo: 'FF001', storeName: 'Test', manager: 'Ops', city: 'Jakarta', category: 'in_city' as const, intervalDays: 7, minimumVisits: 1 };
assert.equal(visitProgress(policy, [], '2026-10-12').remaining, 1);
assert.equal(visitProgress(policy, ['2026-10-12T02:00:00Z'], '2026-10-18').remaining, 0);
assert.equal(visitProgress(policy, ['2026-10-12T02:00:00Z'], '2026-10-18').dueDate, '2026-10-19');
assert.equal(visitProgress(policy, ['2026-10-12T02:00:00Z'], '2026-10-19').remaining, 1);
assert.equal(visitProgress(policy, ['2026-10-11T17:00:00Z'], '2026-10-12').lastVisit, '2026-10-12');
assert.equal(visitProgress({ ...policy, minimumVisits: 2 }, ['2026-10-11T17:00:00Z', '2026-10-12T10:00:00Z'], '2026-10-12').remaining, 1);
// Sunday 11 Oct belongs to the previous Monday–Sunday cycle, so it can't count towards Monday's.
assert.equal(visitProgress({ ...policy, minimumVisits: 2 }, ['2026-10-11T10:00:00Z', '2026-10-12T10:00:00Z'], '2026-10-12').remaining, 1);
assert.equal(visitProgress({ ...policy, minimumVisits: 2 }, ['2026-10-12T10:00:00Z', '2026-10-13T10:00:00Z'], '2026-10-13').remaining, 0);
// A visit anywhere inside the week counts for that week, and the week still ends on Sunday.
assert.equal(visitProgress(policy, ['2026-10-14T03:00:00Z'], '2026-10-18').remaining, 0);
assert.equal(visitProgress(policy, ['2026-10-14T03:00:00Z'], '2026-10-18').dueDate, '2026-10-19');
assert.equal(visitProgress(policy, ['2026-10-14T03:00:00Z'], '2026-10-19').remaining, 1);
assert.equal(visitProgress(policy, [], '2026-10-14').dueDate, '2026-10-18');
assert.equal(visitProgress(policy, ['2026-10-13T10:00:00Z'], '2026-10-12').remaining, 1);
assert.equal(visitProgress(null, [], '2026-10-12').dueDate, null);
// 60/90-day stores use back-to-back 60/90-day cycles from the same Monday (5 Jan 2026):
// 60 days → 2 Sep–31 Oct, 90 days → 2 Oct–30 Dec around 12 Oct.
const p60 = { ...policy, intervalDays: 60 };
const p90 = { ...policy, intervalDays: 90 };
assert.deepEqual(cycleContaining('2026-10-12', 60), { start: '2026-09-02', end: '2026-10-31' });
assert.deepEqual(cycleContaining('2026-10-12', 90), { start: '2026-10-02', end: '2026-12-30' });
assert.equal(visitProgress(p60, ['2026-09-02T10:00:00Z'], '2026-10-12').remaining, 0);
assert.equal(visitProgress(p60, ['2026-09-02T10:00:00Z'], '2026-10-12').dueDate, '2026-11-01');
assert.equal(visitProgress(p60, ['2026-08-14T10:00:00Z'], '2026-10-12').remaining, 1);
assert.equal(visitProgress(p60, ['2026-08-14T10:00:00Z'], '2026-10-12').dueDate, '2026-10-31');
assert.equal(visitProgress(p90, ['2026-10-02T10:00:00Z'], '2026-12-30').remaining, 0);
assert.equal(visitProgress(p90, ['2026-10-02T10:00:00Z'], '2026-12-31').remaining, 1);

// ── Cycle maths ──
assert.deepEqual(cycleContaining('2026-10-12', 7), { start: '2026-10-12', end: '2026-10-18' });
assert.deepEqual(cycleContaining('2026-10-18', 7), { start: '2026-10-12', end: '2026-10-18' });
assert.deepEqual(cycleContaining('2026-10-19', 7), { start: '2026-10-19', end: '2026-10-25' });
assert.deepEqual(cycleContaining('2026-01-04', 7), { start: '2025-12-29', end: '2026-01-04' });
assert.equal(cycleRangeLabel({ start: '2026-10-19', end: '2026-10-25' }), '19–25 Okt');
assert.equal(cycleRangeLabel({ start: '2026-10-26', end: '2026-11-01' }), '26 Okt – 1 Nov');

// Finished cycles: oldest first, and weeks before tracking began are left out (unless met).
const view = visitCycleView(policy, ['2026-10-13T03:24:00Z', '2026-10-21T01:00:00Z'], '2026-10-21', '2026-10-12');
assert.equal(view.current.start, '2026-10-19');
assert.equal(view.current.count, 1);
assert.equal(view.current.daysLeft, 4);
assert.deepEqual(view.past.map((c) => [c.start, c.met]), [['2026-10-12', true]]);
const longRun = visitCycleView(policy, [], '2026-10-21', '2026-08-31');
assert.deepEqual(longRun.past.map((c) => c.start), ['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12']);
assert.ok(longRun.past.every((c) => !c.met));
assert.equal(visitCycleView(policy, [], '2026-10-21').past.length, 8);
assert.equal(visitCycleView(p90, [], '2026-10-21').past.length, 4);
// A cycle that began before tracking started still shows when it was met.
assert.deepEqual(visitCycleView(policy, ['2026-10-12T03:00:00Z'], '2026-10-21', '2026-10-14').past.map((c) => [c.start, c.met]), [['2026-10-12', true]]);

// ── Report rows ──
const base = { storeNo: 'FF001', name: 'Alpha', areaId: 1, areaName: 'DKI', opsNames: ['Ops A'] };
const alpha = buildReportStore({ ...base, id: 1, policy }, [], '2026-10-21', '2026-10-05');
const beta = buildReportStore({ ...base, id: 2, name: 'Beta', policy }, [{ id: 'v1', storeId: 2, at: '2026-10-20T03:00:00Z', by: 'Ops A' }], '2026-10-21', '2026-10-05');
const gamma = buildReportStore({ ...base, id: 3, name: 'Gamma', policy }, [{ id: 'v2', storeId: 3, at: '2026-10-14T03:00:00Z', by: 'Ops A' }], '2026-10-21', '2026-10-05');
const delta = buildReportStore({ ...base, id: 4, name: 'Delta', policy: null }, [], '2026-10-21', '2026-10-05');
assert.equal(reportState(alpha), 'open');
assert.equal(reportState(beta), 'met');
assert.equal(reportState(delta), 'unset');
assert.equal(beta.visits.length, 1);
assert.equal(beta.lastVisit?.by, 'Ops A');
assert.equal(missedLastCycle(alpha)?.start, '2026-10-12');
assert.equal(missedStreak(alpha), 2);
assert.equal(missedLastCycle(gamma), null);
assert.equal(missedStreak(beta), 2); // visited this week, but the two weeks before it were missed
assert.equal(missedStreak(gamma), 0);
// Needs attention first: missed + still owed, then open by deadline, then done, then unset.
assert.deepEqual([delta, beta, gamma, alpha].sort(attentionOrder).map((s) => s.name), ['Alpha', 'Gamma', 'Beta', 'Delta']);
assert.deepEqual(reportTotals([alpha, beta, gamma, delta]), { withPolicy: 3, open: 2, met: 1, unset: 1, missed: 2, endingSoon: 0 });

// ── Calendar ──
const oct = calendarWeeks('2026-10');
assert.equal(oct.length, 5);
assert.deepEqual([oct[0][0], oct[4][6]], ['2026-09-28', '2026-11-01']);
assert.ok(oct.every((w) => w.length === 7 && new Date(`${w[0]}T00:00:00Z`).getUTCDay() === 1));
assert.equal(calendarWeeks('2026-06').length, 5); // 1 Jun 2026 is a Monday
const calVisits = [
  { id: 'v1', storeId: 2, at: '2026-10-20T03:00:00Z', day: '2026-10-20', byId: 'A', by: 'Ops A' },
  { id: 'v2', storeId: 3, at: '2026-10-14T03:00:00Z', day: '2026-10-14', byId: 'A', by: 'Ops A' },
];
const thisWeek = weekCoverage(oct[3], [alpha, beta, gamma, delta], calVisits, '2026-10-21', '2026-10-05');
assert.deepEqual([thisWeek.visited, thisWeek.total, thisWeek.future, thisWeek.untracked], [1, 3, false, false]);
assert.equal(weekCoverage(oct[2], [alpha, beta, gamma], calVisits, '2026-10-21', '2026-10-05').visited, 1);
assert.equal(weekCoverage(oct[4], [alpha], calVisits, '2026-10-21', null).future, true);
assert.equal(weekCoverage(oct[0], [alpha], calVisits, '2026-10-21', '2026-10-05').untracked, true);
assert.equal(source.length, 45);
assert.equal(source.filter((s) => s.category === 'in_city' && s.intervalDays === 7).length, 30);
assert.equal(source.filter((s) => s.category === 'out_city' && s.intervalDays === 60).length, 8);
assert.equal(source.filter((s) => s.category === 'out_city' && s.intervalDays === 90).length, 7);
assert.equal(new Set(source.map((s) => s.storeNo)).size, 45);
source.forEach((s) => assert.ok(validateVisitPolicy(s)));
assert.ok(validateVisitPolicy(policy));
assert.equal(validateVisitPolicy({ ...policy, intervalDays: 0 }), null);
assert.equal(validateVisitPolicy({ ...policy, minimumVisits: 8 }), null);
assert.equal(validateVisitPolicy({ ...policy, category: 'unknown' }), null);
assert.equal(validateVisitPolicy({ ...policy, city: '' }), null);
const task = { id: 'clean', label: 'Kebersihan', requirePhoto: true };
assert.ok(validateVisitTasks([task]));
assert.equal(validateVisitTasks([]), null);
assert.equal(validateVisitTasks([task, task]), null);
assert.equal(validateVisitTasks([task, { ...task, id: 'another', label: ' kebersihan ' }]), null);
assert.equal(validateVisitTasks([{ ...task, id: '__proto__' }]), null);
assert.equal(parseGeoPoint(null, null), null);
assert.equal(parseGeoPoint(91, 0), null);
assert.equal(parseGeoPoint(0, 181), null);
assert.equal(evaluateGeofence({ lat: -6.2, lng: 106.8, accuracy: 20 }, { lat: -6.2, lng: 106.8, radiusM: 100 }).inside, true);
assert.equal(evaluateGeofence({ lat: -7.2, lng: 106.8, accuracy: 99999 }, { lat: -6.2, lng: 106.8, radiusM: 100 }).inside, false);
assert.equal(isOpsMobileReady('/ops/store-visits'), true);
assert.equal(isOpsMobileReady('/ops/store-visits/12'), true);
assert.equal(isOpsMobileReady('/ops/store-visits-other'), false);
console.log('PASS: back-to-back visit cycles, WIB boundaries, distinct-day quotas, report ordering, Excel roster, settings validation, geofence, and mobile routing.');
