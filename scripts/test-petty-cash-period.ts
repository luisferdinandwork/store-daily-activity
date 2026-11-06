// scripts/test-petty-cash-period.ts
// Pure-logic checks for the petty cash period rules (lib/petty-cash-period.ts, lib/petty-cash-review.ts) — no DB.
//   npm run test:petty-cash-period
//
// The rules under test:
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
  deadlineStatus,
  isRefillLate,
  periodLabel,
  periodMonthName,
  receiptPhotoAction,
  refillDeadline,
  reRequestPeriodMonth,
} from '../lib/petty-cash-period';
import { isLockedByVerification } from '../lib/petty-cash-review';

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

console.log('Receipt photo');
const photo = (status: string, hasPhoto: boolean, financeReview: string | null = null) =>
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
ok('Selesai without a photo can still get its first one — unless Finance turned it down', () => {
  assert.equal(photo('completed', false), 'add');
  assert.equal(photo('completed', false, 'accepted'), 'add');
  assert.equal(photo('completed', false, 'needs_fix'), 'none');
  assert.equal(photo('completed', false, 'rejected'), 'none');
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

console.log(`\n${checks} checks passed`);
