// lib/db/schema/enums.ts
import { pgEnum } from 'drizzle-orm/pg-core';

export const issueStatusEnum = pgEnum('issue_status', [
  'reported',
  'in_review',
  'resolved',
]);

export const reportStatusEnum = pgEnum('report_status', [
  'draft',
  'submitted',
]);

export const attendanceStatusEnum = pgEnum('attendance_status', [
  'present',
  'absent',
  'late',
  'excused',
]);

export const taskStatusEnum = pgEnum('task_status', [
  'pending',
  'in_progress',
  'completed',
  'discrepancy',
]);

export const txTypeEnum = pgEnum('tx_type', [
  'credit',
  'debit',
  'qris',
  'ewallet',
  'cash',
]);

export const breakTypeEnum = pgEnum('break_type', [
  'lunch',
  'dinner',
  'full_day_lunch',
  'full_day_dinner',
]);

export type BreakType = typeof breakTypeEnum.enumValues[number];
