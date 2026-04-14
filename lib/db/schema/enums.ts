// lib/db/schema/enums.ts
import { pgEnum } from 'drizzle-orm/pg-core';

export const issueStatusEnum      = pgEnum('issue_status',      ['reported', 'in_review', 'resolved']);
export const reportStatusEnum     = pgEnum('report_status',     ['draft', 'submitted', 'verified', 'rejected']);
export const attendanceStatusEnum = pgEnum('attendance_status', ['present', 'absent', 'late', 'excused']);

export const taskStatusEnum = pgEnum('task_status', [
  'pending',
  'in_progress',
  'completed',
  'discrepancy',   // ← NEW: submitted but figures don't balance; carries forward to next shift
  'verified',
  'rejected',
]);

export const txTypeEnum = pgEnum('tx_type', [
  'credit',
  'debit',
  'qris',
  'ewallet',
  'cash',
]);

export const breakTypeEnum = pgEnum('break_type', ['lunch', 'dinner', 'full_day_lunch', 'full_day_dinner']);
// full_day_lunch / full_day_dinner are the two break slots available to a full-day shift employee.
// This keeps the enum values distinct so a single attendance row can track both breaks separately
// via two break_session rows without ambiguity.

export type BreakType = typeof breakTypeEnum.enumValues[number];