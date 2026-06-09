// lib/shift-tasks.ts
// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers for the "Shift & Tasks" admin feature.
//
// A shift (lookups.shifts) is self-describing. This feature adds a second piece
// of configuration on top of it: WHICH task types should be performed during a
// given shift. Those assignments live in shift_tasks, pointing at a row in the
// task_definitions catalog (see lib/db/schema/shift-tasks.ts).
//
// `task_definitions.code` is intentionally the SAME underscore code used as
// `task.type` everywhere else in the app (e.g. 'store_front', 'grooming'), so a
// shift→task assignment maps cleanly onto the per-type task tables in tasks.ts.
//
// This file is framework-agnostic on purpose (no React / lucide imports) so it
// can be used from API route handlers, the seed script, and the client page.
// ─────────────────────────────────────────────────────────────────────────────

// ─── Palette ──────────────────────────────────────────────────────────────────
// Mirrors lookups.PaletteKey and the colour language used by the schedule +
// task-progress pages, so shifts/tasks render consistently across the app.

export type PaletteKey = 'amber' | 'violet' | 'emerald' | 'sky' | 'rose' | 'slate';

export interface Palette {
  dot:    string;
  bg:     string;
  border: string;
  text:   string;
}

export const ACCENT_PALETTE: Record<PaletteKey, Palette> = {
  amber:   { dot: '#fb923c', bg: '#fff7ed', border: '#fed7aa', text: '#c2410c' },
  violet:  { dot: '#a78bfa', bg: '#f5f3ff', border: '#ddd6fe', text: '#6d28d9' },
  emerald: { dot: '#4ade80', bg: '#f0fdf4', border: '#bbf7d0', text: '#15803d' },
  sky:     { dot: '#38bdf8', bg: '#f0f9ff', border: '#bae6fd', text: '#0369a1' },
  rose:    { dot: '#fb7185', bg: '#fff1f2', border: '#fecdd3', text: '#be123c' },
  slate:   { dot: '#94a3b8', bg: '#f8fafc', border: '#e2e8f0', text: '#475569' },
};

export const PALETTE_KEYS = Object.keys(ACCENT_PALETTE) as PaletteKey[];

/** Resolve an accent string (possibly null / unknown) to a concrete palette. */
export function paletteOf(accent: string | null | undefined): Palette {
  if (accent && accent in ACCENT_PALETTE) return ACCENT_PALETTE[accent as PaletteKey];
  return ACCENT_PALETTE.slate;
}

export function isPaletteKey(value: unknown): value is PaletteKey {
  return typeof value === 'string' && value in ACCENT_PALETTE;
}

// ─── Shift breaks ─────────────────────────────────────────────────────────────
// A shift carries its own meal-break definitions (lookups.shifts.breaks). Each
// break's `type` MUST be a value of the break_type enum (enums.ts), because the
// attendance flow inserts that string into break_sessions.breakType. Keep this
// list in sync with breakTypeEnum.
//
// `label` and `accent` are free-form display hints; the attendance page renders
// them directly (with a slate/Coffee fallback).

export const BREAK_TYPES = ['lunch', 'dinner', 'full_day_lunch', 'full_day_dinner'] as const;
export type BreakTypeCode = typeof BREAK_TYPES[number];

export const BREAK_TYPE_LABELS: Record<BreakTypeCode, string> = {
  lunch:            'Lunch',
  dinner:           'Dinner',
  full_day_lunch:   'Lunch (Full Day)',
  full_day_dinner:  'Dinner (Full Day)',
};

export interface ShiftBreakDef {
  /** Must be a break_type enum value (lunch, dinner, full_day_lunch, …). */
  type:    BreakTypeCode;
  label:   string;
  accent?: PaletteKey;
}

/**
 * Validate + normalise a breaks payload from the client. Rejects unknown break
 * types and duplicates, fills in a default label, and drops invalid accents.
 * Returns a discriminated result so callers can surface a precise 400.
 */
export function normalizeShiftBreaks(
  input: unknown,
): { ok: true; breaks: ShiftBreakDef[] } | { ok: false; error: string } {
  if (input == null) return { ok: true, breaks: [] };
  if (!Array.isArray(input)) return { ok: false, error: 'breaks must be an array' };

  const seen = new Set<string>();
  const out: ShiftBreakDef[] = [];

  for (const raw of input) {
    if (!raw || typeof raw !== 'object') {
      return { ok: false, error: 'each break must be an object' };
    }

    const r = raw as Record<string, unknown>;
    const type = typeof r.type === 'string' ? r.type : '';

    if (!isBreakTypeCode(type)) {
      return { ok: false, error: `invalid break type "${type}"` };
    }
    if (seen.has(type)) {
      return { ok: false, error: `duplicate break type "${type}"` };
    }
    seen.add(type);

    const label =
      (typeof r.label === 'string' && r.label.trim()) || BREAK_TYPE_LABELS[type] || type;
    const accent = isPaletteKey(r.accent) ? (r.accent as PaletteKey) : undefined;

    out.push(accent ? { type, label, accent } : { type, label });
  }

  return { ok: true, breaks: out };
}

export function isBreakTypeCode(value: unknown): value is BreakTypeCode {
  return typeof value === 'string' && (BREAK_TYPES as readonly string[]).includes(value);
}

// ─── Icon names ───────────────────────────────────────────────────────────────
// Glyph NAMES only (strings). The client page maps these to lucide-react
// components; keeping them as strings avoids importing UI deps here.

export const SHIFT_ICON_NAMES = [
  'sun', 'moon', 'zap', 'sunrise', 'clock', 'coffee',
] as const;
export type ShiftIconName = typeof SHIFT_ICON_NAMES[number];

// ─── Task catalog ────────────────────────────────────────────────────────────
// The canonical list of task types that can be assigned to a shift. Used to
// seed task_definitions and as a safe UI fallback. `code` MUST match the
// `task.type` used elsewhere (underscore form).

export const TASK_TYPES = [
  'store_opening',
  'store_front',
  'setoran',
  'cek_bin',
  'vm_checklist',
  'marketing_check',
  'item_dropping',
  'briefing',
  'serah_terima',
  'edc_reconciliation',
  'eod_z_report',
  'open_statement',
  'grooming',
] as const;

export type TaskType = typeof TASK_TYPES[number];

export interface TaskCatalogEntry {
  code:        TaskType;
  label:       string;
  description?: string | null;
  icon:        string;       // lucide component name (PascalCase)
  accent:     PaletteKey;
  isPersonal: boolean;      // grooming is per-employee rather than per-store
  sortOrder:  number;
}

export const TASK_CATALOG: TaskCatalogEntry[] = [
  { code: 'store_opening',      label: 'Store Opening',      icon: 'DoorClosed',   accent: 'amber',   isPersonal: false, sortOrder: 10  },
  { code: 'store_front',        label: 'Store Front',        icon: 'Store',        accent: 'amber',   isPersonal: false, sortOrder: 20  },
  { code: 'setoran',            label: 'Setoran',            icon: 'WalletCards',  accent: 'emerald', isPersonal: false, sortOrder: 30  },
  { code: 'cek_bin',            label: 'Cek Bin',            icon: 'PackageCheck', accent: 'sky',     isPersonal: false, sortOrder: 40  },
  { code: 'vm_checklist',       label: 'VM Checklist',       icon: 'MonitorCheck', accent: 'violet',  isPersonal: false, sortOrder: 50  },
  { code: 'marketing_check',    label: 'Marketing Check',    icon: 'Megaphone',    accent: 'rose',    isPersonal: false, sortOrder: 60  },
  { code: 'item_dropping',      label: 'Item Dropping',      icon: 'PackageCheck', accent: 'sky',     isPersonal: false, sortOrder: 70  },
  { code: 'briefing',           label: 'Briefing',           icon: 'UsersRound',   accent: 'violet',  isPersonal: false, sortOrder: 80  },
  { code: 'serah_terima',       label: 'Serah Terima',       icon: 'Repeat2',      accent: 'sky',     isPersonal: false, sortOrder: 90  },
  { code: 'edc_reconciliation', label: 'EDC Reconciliation', icon: 'ReceiptText',  accent: 'emerald', isPersonal: false, sortOrder: 100 },
  { code: 'eod_z_report',       label: 'EOD Z Report',       icon: 'FileText',     accent: 'slate',   isPersonal: false, sortOrder: 110 },
  { code: 'open_statement',     label: 'Open Statement',     icon: 'ListChecks',   accent: 'slate',   isPersonal: false, sortOrder: 120 },
  { code: 'grooming',           label: 'Grooming',           icon: 'Shirt',        accent: 'rose',    isPersonal: true,  sortOrder: 130 },
];

export const TASK_CATALOG_CODES = TASK_CATALOG.map((task) => task.code);

const CATALOG_BY_CODE = new Map<TaskType, TaskCatalogEntry>(
  TASK_CATALOG.map((t) => [t.code, t]),
);

export function isTaskType(value: unknown): value is TaskType {
  return typeof value === 'string' && (TASK_TYPES as readonly string[]).includes(value);
}

export function getTaskCatalogEntry(code: string): TaskCatalogEntry | null {
  return isTaskType(code) ? CATALOG_BY_CODE.get(code) ?? null : null;
}

/** Human label for a task code, falling back to a de-underscored version. */
export function taskLabel(code: string): string {
  return getTaskCatalogEntry(code)?.label ?? code.replaceAll('_', ' ');
}

// ─── Shift task mapping ──────────────────────────────────────────────────────
// This is the default/current business rule used by:
// - scripts/seed-shift-tasks.ts
// - employee task API filtering
// - employee task page fallback rendering
//
// Full-day intentionally gets every task from TASK_CATALOG.

export const SHIFT_CODES = ['morning', 'evening', 'full_day'] as const;
export type ShiftCode = typeof SHIFT_CODES[number];

export const MORNING_TASK_TYPES: TaskType[] = [
  'store_opening',
  'store_front',
  'setoran',
  'cek_bin',
  'vm_checklist',
  'marketing_check',
  'item_dropping',
  'briefing',
  'serah_terima',
  'grooming',
];

export const EVENING_TASK_TYPES: TaskType[] = [
  'item_dropping',
  'briefing',
  'serah_terima',
  'edc_reconciliation',
  'eod_z_report',
  'open_statement',
  'grooming',
];

export const FULL_DAY_TASK_TYPES: TaskType[] = [...TASK_CATALOG_CODES];

export const SHIFT_TASK_MAP: Record<ShiftCode, TaskType[]> = {
  morning:  MORNING_TASK_TYPES,
  evening:  EVENING_TASK_TYPES,
  full_day: FULL_DAY_TASK_TYPES,
};

/** Shared store-level tasks that should be unique per store/date/shift. */
export const SHIFT_SCOPED_SHARED_TASK_TYPES = [
  'briefing',
  'item_dropping',
  'serah_terima',
] as const satisfies readonly TaskType[];

export const SHIFT_SCOPED_SHARED_TASK_TYPE_SET = new Set<TaskType>(
  SHIFT_SCOPED_SHARED_TASK_TYPES,
);

export function isShiftCode(value: unknown): value is ShiftCode {
  return typeof value === 'string' && (SHIFT_CODES as readonly string[]).includes(value);
}

export function normalizeShiftCode(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function toShiftCode(input: string | null | undefined): ShiftCode | null {
  const code = normalizeShiftCode(input ?? '');
  return isShiftCode(code) ? code : null;
}

export function isValidShiftCode(code: string): boolean {
  return /^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(code);
}

export function getDefaultTaskCodesForShift(shiftCode: string | null | undefined): TaskType[] {
  const code = toShiftCode(shiftCode);
  return code ? [...SHIFT_TASK_MAP[code]] : [];
}

export function getAllowedTaskTypesForShifts(shiftCodes: Array<string | null | undefined>): Set<TaskType> {
  const allowed = new Set<TaskType>();

  for (const rawCode of shiftCodes) {
    const shiftCode = toShiftCode(rawCode);
    if (!shiftCode) continue;

    for (const taskType of SHIFT_TASK_MAP[shiftCode]) {
      allowed.add(taskType);
    }
  }

  return allowed;
}

export function isTaskAllowedForShift(
  taskType: string,
  shiftCode: string | null | undefined,
): boolean {
  const code = toShiftCode(shiftCode);
  if (!code || !isTaskType(taskType)) return false;
  return SHIFT_TASK_MAP[code].includes(taskType);
}

export function isShiftScopedSharedTask(taskType: string): taskType is typeof SHIFT_SCOPED_SHARED_TASK_TYPES[number] {
  return isTaskType(taskType) && SHIFT_SCOPED_SHARED_TASK_TYPE_SET.has(taskType);
}

// ─── DTOs shared by the API and the page ──────────────────────────────────────

export interface TaskDefinitionDTO {
  id:          number;
  code:        string;
  label:       string;
  description: string | null;
  icon:        string | null;
  accent:      string | null;
  isPersonal:  boolean;
  isActive:    boolean;
  sortOrder:   number;
}

export interface ShiftTaskAssignment {
  id:               number;   // shift_tasks.id
  taskDefinitionId: number;
  code:             string;
  label:            string;
  icon:             string | null;
  accent:           string | null;
  isPersonal:       boolean;
  isRequired:       boolean;
  isActive:         boolean;
  sortOrder:        number;
}

export interface ShiftWithTasks {
  id:          number;
  code:        string;
  label:       string;
  description: string | null;
  startTime:   string | null;
  endTime:     string | null;
  accent:      string | null;
  icon:        string | null;
  breaks:      ShiftBreakDef[] | null;
  isActive:    boolean;
  sortOrder:   number;
  tasks:       ShiftTaskAssignment[];
}

export interface ShiftTasksPayload {
  success: boolean;
  error?:  string;
  shifts:  ShiftWithTasks[];
  catalog: TaskDefinitionDTO[];
}

// ─── Small view helpers ─────────────────────────────────────────────────────

/** "07:00:00" → "07:00"; null-safe. */
export function trimTime(t: string | null | undefined): string {
  if (!t) return '';
  return t.slice(0, 5);
}

/** "07:00–22:00" style range for a shift, or "" when no times set. */
export function shiftTimeRange(start: string | null, end: string | null): string {
  const s = trimTime(start);
  const e = trimTime(end);
  if (s && e) return `${s}–${e}`;
  if (s) return `from ${s}`;
  if (e) return `until ${e}`;
  return '';
}

export function activeTaskCount(shift: ShiftWithTasks): number {
  return shift.tasks.filter((t) => t.isActive).length;
}
