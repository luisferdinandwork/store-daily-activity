// lib/db/schema/enums.ts
import { pgEnum } from 'drizzle-orm/pg-core';

export const userRoleEnum         = pgEnum('user_role',         ['employee', 'ops', 'finance', 'admin']);
export const employeeTypeEnum     = pgEnum('employee_type',     ['pic_1', 'pic_2', 'so']);
export const shiftEnum            = pgEnum('shift',             ['morning', 'evening']);
export const issueStatusEnum      = pgEnum('issue_status',      ['reported', 'in_review', 'resolved']);
export const reportStatusEnum     = pgEnum('report_status',     ['draft', 'submitted', 'verified', 'rejected']);
export const attendanceStatusEnum = pgEnum('attendance_status', ['present', 'absent', 'late', 'excused']);

export const taskStatusEnum = pgEnum('task_status', [
  'pending',
  'in_progress',
  'completed',
  'verified',
  'rejected',
]);

export const breakTypeEnum = pgEnum('break_type', ['lunch', 'dinner']);

// ─── Derived TypeScript types ─────────────────────────────────────────────────

export type BreakType = typeof breakTypeEnum.enumValues[number];  // 'lunch' | 'dinner'
export type Shift     = typeof shiftEnum.enumValues[number];       // 'morning' | 'evening'