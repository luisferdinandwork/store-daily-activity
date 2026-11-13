// scripts/test-petty-cash-period.ts
// Pure-logic checks for the petty cash period rules (lib/petty-cash-period.ts, lib/petty-cash-review.ts) — no DB.
//   npm run test:petty-cash-period
//
// The rules under test:
//   • THE CALENDAR changes the period: it runs 16th → 15th and is named after the month it ends in, so the 16th
//     starts the next one (a Refill never does);
//   • which period a Refill settles: the oldest used period without a refill, up to the one in use;
//   • the Refill of a period is due on or before the 15th of its month; later is "late" (never blocked), and
//     periods before the rule existed are never late;
//   • a Re-request is counted in the period AFTER the original's — never one already closed;
//   • a request's receipt photo can be swapped only until it is Selesai; finished = locked, except adding the
//     first photo to a finished request that never had one;
//   • a Finance decision locks by PERIOD: once the refill of a period is verified, that period (and earlier ones)
//     are locked, the next period stays open.

import assert from 'node:assert/strict';

import {
  addMonths,
  dayLabel,
  deadlineStatus,
  isRefillLate,
  periodLabel,
  periodMonthName,
  periodRangeLabel,
  periodWindow,
  pickRefillPeriod,
  receiptPhotoAction,
  refillDeadline,
  refillNotYetOpen,
  refillRequiredFirst,
  reRequestPeriodMonth,
  uncoveredUsage,
  usagePeriodFor,
  type RefillCandidate,
} from '../lib/petty-cash-period';
import { isLockedByVerification, visibleReviewOutcome } from '../lib/petty-cash-review';
import { requestGroup } from '../lib/employee-petty-cash-view';

let checks = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  checks += 1;
  console.log(`  ✓ ${name}`);
};

console.log('Period names');
ok('addMonths rolls over the year', () => {
  assert.equal(addMonths('2026-11', 1), '2026-12');
  assert.equal(addMonths('2026-12', 1), '2027-01');
  assert.equal(addMonths('2026-01', -1), '2025-12');
});
ok('labels are Indonesian', () => {
  assert.equal(periodLabel('2026-11'), 'November 2026');
  assert.equal(periodLabel('2026-12'), 'Desember 2026');
  assert.equal(periodMonthName('2026-03'), 'Maret');
});

console.log('The 15th');
ok('deadline is the 15th of the period month', () => {
  assert.equal(refillDeadline('2026-11'), '2026-11-15');
});
ok('on the 15th it is still on time, the 16th is late', () => {
  assert.equal(deadlineStatus('2026-11', '2026-11-15').late, false);
  assert.equal(deadlineStatus('2026-11', '2026-11-15').daysLeft, 0);
  assert.equal(deadlineStatus('2026-11', '2026-11-16').late, true);
  assert.equal(deadlineStatus('2026-11', '2026-11-16').daysLeft, -1);
});
ok('days left counts down to the deadline', () => {
  assert.equal(deadlineStatus('2026-11', '2026-11-06').daysLeft, 9);
  assert.equal(deadlineStatus('2026-11', '2026-11-01').daysLeft, 14);
});
ok('a refill of an earlier month sent in the next one is late', () => {
  assert.equal(isRefillLate('2026-11', '2026-12-02'), true);
  assert.equal(isRefillLate('2026-11', '2026-11-14'), false);
});
ok('periods before the rule existed are never late', () => {
  assert.equal(deadlineStatus('2026-10', '2026-11-20').applies, false);
  assert.equal(isRefillLate('2026-10', '2026-11-20'), false);
});

console.log('Re-request period');
ok('a Re-request goes to the period after the original', () => {
  // original filed in November while November was still in use → December
  assert.equal(reRequestPeriodMonth('2026-11', '2026-11'), '2026-12');
});
ok('…and never to a closed one: an old original goes to the period in use', () => {
  assert.equal(reRequestPeriodMonth('2026-09', '2026-12'), '2026-12');
  assert.equal(reRequestPeriodMonth('2026-11', '2026-12'), '2026-12');
});
ok('across a year end', () => {
  assert.equal(reRequestPeriodMonth('2026-12', '2026-12'), '2027-01');
});

console.log('The calendar decides the period');
ok('up to and including the 15th it is this month, from the 16th the next month', () => {
  assert.equal(usagePeriodFor('2026-11-01'), '2026-11');
  assert.equal(usagePeriodFor('2026-11-15'), '2026-11');
  assert.equal(usagePeriodFor('2026-11-16'), '2026-12');
  assert.equal(usagePeriodFor('2026-11-30'), '2026-12');
});
ok('across a year end', () => {
  assert.equal(usagePeriodFor('2026-12-15'), '2026-12');
  assert.equal(usagePeriodFor('2026-12-16'), '2027-01');
  assert.equal(usagePeriodFor('2026-12-31'), '2027-01');
  assert.equal(usagePeriodFor('2027-01-01'), '2027-01');
  assert.equal(usagePeriodFor('2027-01-15'), '2027-01');
});
ok('a period runs from the 16th of the month before to the 15th of its name', () => {
  assert.deepEqual(periodWindow('2026-11'), { from: '2026-10-16', to: '2026-11-15' });
  assert.deepEqual(periodWindow('2027-01'), { from: '2026-12-16', to: '2027-01-15' });
  assert.equal(periodRangeLabel('2026-11'), '16 Okt – 15 Nov 2026');
  assert.equal(periodRangeLabel('2027-01'), '16 Des 2026 – 15 Jan 2027');
});
ok('the periods tile the calendar: every day is in exactly the period whose window holds it', () => {
  for (let d = Date.UTC(2026, 8, 1); d < Date.UTC(2027, 3, 1); d += 86_400_000) {
    const day = new Date(d).toISOString().slice(0, 10);
    const { from, to } = periodWindow(usagePeriodFor(day));
    assert.ok(day >= from && day <= to, `${day} is outside ${from}…${to}`);
  }
});
ok('the last day of a period is also the day its refill is on time', () => {
  assert.equal(periodWindow('2026-11').to, refillDeadline('2026-11'));
  assert.equal(isRefillLate('2026-11', periodWindow('2026-11').to), false);
  assert.equal(isRefillLate('2026-11', '2026-11-16'), true);
});

console.log('Which period a Refill settles');
const used = (month: string, balance = 900_000, settled = false): RefillCandidate => ({ month, balance, settled });
ok('on the 10th, previous period settled: the period in use', () => {
  assert.equal(pickRefillPeriod([used('2026-10', 900_000, true), used('2026-11')], '2026-11'), '2026-11');
});
ok('after the 15th, the period that just ended has no refill yet: it goes first (late)', () => {
  // 20 Nov → period in use is 2026-12; November was never asked for
  assert.equal(pickRefillPeriod([used('2026-11'), used('2026-12', 950_000)], '2026-12'), '2026-11');
});
ok('after the 15th, the ended period already has its refill: the period in use', () => {
  assert.equal(pickRefillPeriod([used('2026-11', 900_000, true), used('2026-12', 950_000)], '2026-12'), '2026-12');
});
ok('on or before the 15th with the previous period still waiting: the previous one first', () => {
  assert.equal(pickRefillPeriod([used('2026-10'), used('2026-11')], '2026-11'), '2026-10');
});
ok('a period nobody used needs no refill', () => {
  assert.equal(pickRefillPeriod([used('2026-11', 1_000_000), used('2026-12', 950_000)], '2026-12'), '2026-12');
  assert.equal(pickRefillPeriod([used('2026-11', 900_000, true), used('2026-12', 1_000_000)], '2026-12'), null);
});
ok('nothing to refill when every used period is settled', () => {
  assert.equal(pickRefillPeriod([used('2026-11', 900_000, true), used('2026-12', 900_000, true)], '2026-12'), null);
  assert.equal(pickRefillPeriod([], '2026-12'), null);
});
ok('a period ahead of the one in use (made for a Re-request) is never the target', () => {
  assert.equal(pickRefillPeriod([used('2026-11'), used('2026-12', 950_000)], '2026-11'), '2026-11');
  assert.equal(pickRefillPeriod([used('2026-11', 900_000, true), used('2026-12', 950_000)], '2026-11'), null);
});
ok('periods older than the latest settled one belong to a cycle that is already done', () => {
  assert.equal(pickRefillPeriod([used('2026-08'), used('2026-10', 900_000, true), used('2026-11')], '2026-11'), '2026-11');
});
ok('a refill OPS turned down leaves its period waiting (it is simply not "settled")', () => {
  assert.equal(pickRefillPeriod([used('2026-11', 900_000, false), used('2026-12', 950_000)], '2026-12'), '2026-11');
});

console.log('Usage after the amount was frozen');
ok('what Finance sent covers what was used then; later usage is the shortfall', () => {
  assert.equal(uncoveredUsage(900_000, 100_000), 0);
  assert.equal(uncoveredUsage(850_000, 100_000), 50_000);
});
ok('no frozen amount (refill not verified yet, or none asked for) → it will cover everything', () => {
  assert.equal(uncoveredUsage(850_000, null), 0);
  assert.equal(uncoveredUsage(850_000, undefined), 0);
});
ok('a request given back afterwards never makes the shortfall negative', () => {
  assert.equal(uncoveredUsage(960_000, 100_000), 0);
});

console.log('Receipt photo');
const photo =(status: string, hasPhoto: boolean, financeReview: string | null = null) =>
  receiptPhotoAction({ status, hasPhoto, financeReview });
ok('before Selesai the photo can be replaced', () => {
  assert.equal(photo('ops_approved', true), 'replace');
  assert.equal(photo('ops_approved', false), 'add');
});
ok('waiting on OPS or turned down by OPS: nothing to do', () => {
  assert.equal(photo('pending_ops', true), 'none');
  assert.equal(photo('ops_rejected', true), 'none');
});
ok('Selesai with a photo is locked — whatever Finance decided', () => {
  assert.equal(photo('completed', true), 'locked');
  assert.equal(photo('completed', true, 'accepted'), 'locked');
  assert.equal(photo('completed', true, 'needs_fix'), 'locked');
  assert.equal(photo('completed', true, 'rejected'), 'locked');
});
ok('Selesai without a photo can still get its first one — Ditolak too (PIC 1 may not see it yet)', () => {
  assert.equal(photo('completed', false), 'add');
  assert.equal(photo('completed', false, 'accepted'), 'add');
  assert.equal(photo('completed', false, 'rejected'), 'add');
  assert.equal(photo('completed', false, 'needs_fix'), 'none');
});

console.log('Finance lock follows the period');
ok('no verified refill → nothing is locked', () => {
  assert.equal(isLockedByVerification('2026-11', undefined), false);
  assert.equal(isLockedByVerification('2026-11', null), false);
});
ok('November verified: November is locked, December (filed while it was on its way) is not', () => {
  assert.equal(isLockedByVerification('2026-11', '2026-11'), true);
  assert.equal(isLockedByVerification('2026-10', '2026-11'), true);
  assert.equal(isLockedByVerification('2026-12', '2026-11'), false);
});

console.log('A refill ends its period, but never before the period has started');
ok('the period in use (or an older one) can always be refilled', () => {
  assert.equal(refillNotYetOpen('2026-11', '2026-11-10'), null);
  assert.equal(refillNotYetOpen('2026-10', '2026-11-10'), null);
  assert.equal(refillNotYetOpen('2026-12', '2026-11-16'), null);
});
ok('a period that starts on the 16th can not be refilled before it (no running 2 periods ahead)', () => {
  assert.equal(refillNotYetOpen('2026-12', '2026-11-10'), '2026-11-16');
  assert.equal(refillNotYetOpen('2026-12', '2026-11-15'), '2026-11-16');
  assert.equal(refillNotYetOpen('2027-01', '2026-11-20'), '2026-12-16');
});
ok('the day is written the Indonesian way', () => {
  assert.equal(dayLabel('2026-11-16'), '16 Nov 2026');
  assert.equal(dayLabel('2026-12-16'), '16 Des 2026');
});

console.log('The Refill of an ended period comes before any new request');
ok('a period that ended without its Refill blocks new requests until it is sent', () => {
  // 20 Nov: December in use, November used and never asked for
  assert.equal(refillRequiredFirst('2026-11', '2026-12'), '2026-11');
});
ok('the period in use itself never blocks (its Refill is simply due by the 15th)', () => {
  assert.equal(refillRequiredFirst('2026-12', '2026-12'), null);
});
ok('nothing to send (or a Refill already on its way) blocks nothing', () => {
  assert.equal(refillRequiredFirst(null, '2026-12'), null);
  assert.equal(refillRequiredFirst(undefined, '2026-12'), null);
});
ok('periods before the deadline rule are never asked for', () => {
  assert.equal(refillRequiredFirst('2026-10', '2026-11'), null);
});

console.log('What PIC 1 sees of Finance\'s decision');
ok('Diterima / Ditolak stay hidden until the Refill of the request\'s period has been sent', () => {
  assert.equal(visibleReviewOutcome('rejected', '2026-12', null), 'none');
  assert.equal(visibleReviewOutcome('accepted', '2026-12', null), 'none');
  assert.equal(visibleReviewOutcome('rejected', '2026-12', '2026-11'), 'none');
  assert.equal(visibleReviewOutcome('rejected', '2026-12', '2026-12'), 'rejected');
  assert.equal(visibleReviewOutcome('accepted', '2026-11', '2026-12'), 'accepted');
});
ok('Perlu Perbaikan always shows (the request is back with PIC 1), no decision shows nothing', () => {
  assert.equal(visibleReviewOutcome('needs_fix', '2026-12', null), 'needs_fix');
  assert.equal(visibleReviewOutcome(null, '2026-12', '2026-12'), 'none');
});

console.log('The state pill on the employee list');
const pill = (status: string, review: 'none' | 'accepted' | 'rejected' | 'needs_fix', refillSent: boolean, imageUrl: string | null = 'x') =>
  requestGroup({ status, reviewOutcome: review, refillSent, imageUrl });
ok('the OPS flow: Menunggu OPS → Perlu tindakan → no status at all (never Selesai before the Refill)', () => {
  assert.equal(pill('pending_ops', 'none', false), 'pending_ops');
  assert.equal(pill('ops_approved', 'none', false, null), 'action');
  assert.equal(pill('completed', 'none', false), 'approved');
  assert.equal(pill('ops_rejected', 'none', false), 'rejected');
});
ok('after the Refill: Pending, Selesai only when Diterima, Ditolak; Perlu Perbaikan always', () => {
  assert.equal(pill('completed', 'none', true), 'pending');
  assert.equal(pill('completed', 'accepted', true), 'done');
  assert.equal(pill('completed', 'rejected', true), 'rejected');
  assert.equal(pill('draft', 'needs_fix', false), 'needs_fix');
});

console.log(`\n${checks} checks passed`);
