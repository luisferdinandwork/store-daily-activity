// lib/db/utils/task-attendance-gate.ts
//
// The one attendance check every task runs before letting an employee work on
// it: they must be checked in for the schedule AND not out on a break. A break
// (startBreak) takes the employee out of the store; tasks stay locked until
// they come back and check in again (employeeCheckIn → endBreak).
// The per-task utils' assertCheckedIn() helpers delegate here.

import { db } from '@/lib/db';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { attendance, breakSessions } from '@/lib/db/schema';
import { NOT_CHECKED_IN_TASK_MESSAGE, ON_BREAK_TASK_MESSAGE } from '@/lib/break-reminder';

export type TaskAttendanceGate =
  | { ok: true }
  | { ok: false; reason: 'not_checked_in'; message: string }
  | { ok: false; reason: 'on_break'; message: string; breakOutTime: Date | null };

type AttendanceGateRow = { id: number; checkInTime: Date | null; onBreak: boolean } | undefined;

/** Judges an attendance row already read; reads the open break only when on break. */
export async function judgeAttendanceRow(att: AttendanceGateRow): Promise<TaskAttendanceGate> {
  if (!att?.checkInTime) {
    return { ok: false, reason: 'not_checked_in', message: NOT_CHECKED_IN_TASK_MESSAGE };
  }
  if (!att.onBreak) return { ok: true };

  const [open] = await db
    .select({ breakOutTime: breakSessions.breakOutTime })
    .from(breakSessions)
    .where(and(eq(breakSessions.attendanceId, att.id), isNull(breakSessions.returnTime)))
    .orderBy(desc(breakSessions.breakOutTime))
    .limit(1);

  return {
    ok: false,
    reason: 'on_break',
    message: ON_BREAK_TASK_MESSAGE,
    breakOutTime: open?.breakOutTime ?? null,
  };
}

/** Gate for one schedule (optionally only when that attendance is `userId`'s). */
export async function getTaskAttendanceGate(
  scheduleId: number,
  userId?: string,
): Promise<TaskAttendanceGate> {
  const where = userId
    ? and(eq(attendance.scheduleId, scheduleId), eq(attendance.userId, userId))
    : eq(attendance.scheduleId, scheduleId);

  const [att] = await db
    .select({ id: attendance.id, checkInTime: attendance.checkInTime, onBreak: attendance.onBreak })
    .from(attendance)
    .where(where)
    .limit(1);

  return judgeAttendanceRow(att);
}

/** Error message for a task action, or null when the employee may work. */
export async function taskAttendanceProblem(scheduleId: number, userId?: string): Promise<string | null> {
  const gate = await getTaskAttendanceGate(scheduleId, userId);
  return gate.ok ? null : gate.message;
}
