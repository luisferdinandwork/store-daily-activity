// lib/employee-tasks/normalize-visible-tasks.ts
// Frontend/API-safe normalizer for employee task cards.
//
// Purpose:
// - briefing, item_dropping, and serah_terima are shared daily morning tasks.
// - If old DB rows still contain morning + evening/full_day duplicates, only show one card.
// - full_day employees should still see the task, but it should be shown/grouped as morning.
//
// You can use this helper in app/employee/tasks/page.tsx or directly inside
// /api/employee/tasks before returning the task list.

export type EmployeeTaskShift = 'morning' | 'evening' | 'full_day' | string;

export interface NormalizableEmployeeTask {
  id?: number | string;
  taskId?: number | string;
  type?: string;
  taskType?: string;
  code?: string;
  slug?: string;
  title?: string;
  name?: string;
  shift?: EmployeeTaskShift;
  shiftCode?: EmployeeTaskShift;
  schedule?: {
    shift?: EmployeeTaskShift;
    shiftCode?: EmployeeTaskShift;
  };
  status?: string;
  date?: string;
  href?: string;
  url?: string;
  [key: string]: unknown;
}

const MORNING_ONLY_SHARED_TASK_TYPES = new Set([
  'briefing',
  'item_dropping',
  'item-dropping',
  'serah_terima',
  'serah-terima',
]);

function normalizeTaskType(task: NormalizableEmployeeTask): string {
  return String(
    task.type ??
    task.taskType ??
    task.code ??
    task.slug ??
    task.title ??
    task.name ??
    '',
  )
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}

function normalizeShift(task: NormalizableEmployeeTask): string {
  return String(
    task.shiftCode ??
    task.shift ??
    task.schedule?.shiftCode ??
    task.schedule?.shift ??
    '',
  )
    .trim()
    .toLowerCase();
}

export function isMorningOnlySharedTask(task: NormalizableEmployeeTask): boolean {
  return MORNING_ONLY_SHARED_TASK_TYPES.has(normalizeTaskType(task));
}

export function normalizeTaskForDisplay<T extends NormalizableEmployeeTask>(task: T): T {
  if (!isMorningOnlySharedTask(task)) return task;

  return {
    ...task,
    shift: 'morning',
    shiftCode: 'morning',
    schedule: task.schedule
      ? {
          ...task.schedule,
          shift: 'morning',
          shiftCode: 'morning',
        }
      : task.schedule,
  };
}

export function normalizeVisibleEmployeeTasks<T extends NormalizableEmployeeTask>(
  tasks: T[],
): T[] {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const rawTask of tasks) {
    const type = normalizeTaskType(rawTask);
    const shift = normalizeShift(rawTask);

    if (MORNING_ONLY_SHARED_TASK_TYPES.has(type)) {
      // Hide old duplicated evening/full_day rows if the backend still returns them.
      // A full_day employee should still see the morning row, not a separate full_day row.
      if (shift && shift !== 'morning') continue;

      const key = `${type}:morning`;
      if (seen.has(key)) continue;

      seen.add(key);
      result.push(normalizeTaskForDisplay(rawTask));
      continue;
    }

    const taskId = rawTask.taskId ?? rawTask.id ?? '';
    const key = `${type}:${shift || 'none'}:${taskId}`;
    if (seen.has(key)) continue;

    seen.add(key);
    result.push(rawTask);
  }

  return result;
}
