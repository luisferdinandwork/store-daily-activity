// lib/db/schema/enums.ts
import { pgEnum } from 'drizzle-orm/pg-core';

export const issueStatusEnum = pgEnum('issue_status', [
  'draft',
  'reported',
  'in_review',
  'solved',
  'completed',
]);

export const reportStatusEnum = pgEnum('report_status', [
  'draft',
  'submitted',
]);

// Keep in sync with lib/attendance-status.ts. Ops sets Dinas, Izin (excused)
// and Back-up (covering another shift) on a scheduled day; Cuti (C), Sakit
// tanpa surat (STD) and Sakit dengan surat (SD) are legacy values still read.
export const attendanceStatusEnum = pgEnum('attendance_status', [
  'present',
  'absent',
  'late',
  'excused',
  'dinas',
  'cuti',
  'sakit_tanpa_surat',
  'sakit_dengan_surat',
  'backup',
]);

// Keep in sync with lib/cash-count-sessions.ts — the five SOP moments the
// cashier cash is counted (store_cash_counts.session).
export const cashCountSessionEnum = pgEnum('cash_count_session', [
  'pagi',
  'siang_1',
  'siang_2',
  'sore',
  'malam',
]);

// Keep in sync with lib/store-status.ts. Lifecycle of a store:
//   ready_to_open → active → close
// Only `active` stores take part in day-to-day operations (attendance, tasks,
// petty cash); `ready_to_open` is preparation-only (schedules, targets).
export const storeStatusEnum = pgEnum('store_status', [
  'active',
  'close',
  'ready_to_open',
]);

export const taskStatusEnum = pgEnum('task_status', [
  'not_started',
  'in_progress',
  'completed',
  'pending',
  'on_hold',
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
