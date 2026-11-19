// lib/break-reminder.ts
//
// Client-safe rules for the employee break ("istirahat"). An employee who
// starts a break is out of the store: every task is locked until they come
// back and check in again (endBreak), and once a break has run
// BREAK_REMINDER_MINUTES they get a reminder — a bell notification
// (lib/db/utils/break-reminders.ts) and a banner on the employee home page.

/** Minutes after break-out when the "come back and check in" reminder fires. */
export const BREAK_REMINDER_MINUTES = 30;

const MINUTE_MS = 60_000;

/** When the reminder for a break that started at `breakOutTime` is due. */
export function breakReminderDueAt(breakOutTime: Date | string): Date {
  return new Date(new Date(breakOutTime).getTime() + BREAK_REMINDER_MINUTES * MINUTE_MS);
}

/** True once an open break has run BREAK_REMINDER_MINUTES or longer. */
export function isBreakOverdue(breakOutTime: Date | string, now: Date = new Date()): boolean {
  return now.getTime() >= breakReminderDueAt(breakOutTime).getTime();
}

/** Whole minutes since the break started (never negative). */
export function breakMinutesElapsed(breakOutTime: Date | string, now: Date = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(breakOutTime).getTime()) / MINUTE_MS));
}

/** HH:MM in Asia/Jakarta — the store clock, whatever the device/server zone. */
export function breakClock(value: Date | string): string {
  return new Date(value).toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Jakarta',
  });
}

/** Server message when a task is tried while the employee is on break. */
export const ON_BREAK_TASK_MESSAGE =
  'Kamu sedang istirahat. Kembali ke toko dan absen masuk lagi di halaman Attendance sebelum mengerjakan task.';

export const NOT_CHECKED_IN_TASK_MESSAGE =
  'Kamu belum absen masuk. Lakukan absensi masuk terlebih dahulu sebelum mengerjakan task.';

/** Notification type (notifications.type) + related pointer for the reminder. */
export const BREAK_REMINDER_TYPE = 'break_return_reminder';
export const BREAK_REMINDER_RELATED_TYPE = 'break_session';

export function breakReminderText(breakOutTime: Date | string): { title: string; body: string } {
  return {
    title: `Istirahat sudah ${BREAK_REMINDER_MINUTES} menit`,
    body:
      `Kamu istirahat sejak ${breakClock(breakOutTime)}. Segera kembali ke toko dan absen masuk lagi — ` +
      'task terkunci sampai kamu kembali.',
  };
}
