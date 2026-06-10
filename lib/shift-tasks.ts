// lib/shift-tasks.ts
// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers for the "Shift & Tasks" admin feature.
//
// This file is used by:
//   • scripts/seed-shift-tasks.ts
//   • OPS Shift & Tasks admin page
//   • any helper that needs stable task codes/labels
//
// IMPORTANT:
// Store Closing replaces these removed task codes entirely:
//   • edc_reconciliation
//   • eod_z_report
//   • open_statement
// Do not re-add those codes to TASK_CATALOG or SHIFT_TASK_MAP.
// ─────────────────────────────────────────────────────────────────────────────

// ─── Palette ──────────────────────────────────────────────────────────────────

export type PaletteKey = 'amber' | 'violet' | 'emerald' | 'sky' | 'rose' | 'slate';

export interface Palette {
  dot: string;
  bg: string;
  border: string;
  text: string;
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

export function paletteOf(accent: string | null | undefined): Palette {
  if (accent && accent in ACCENT_PALETTE) return ACCENT_PALETTE[accent as PaletteKey];
  return ACCENT_PALETTE.slate;
}

export function isPaletteKey(value: unknown): value is PaletteKey {
  return typeof value === 'string' && value in ACCENT_PALETTE;
}

// ─── Shift breaks ─────────────────────────────────────────────────────────────

export const BREAK_TYPES = ['lunch', 'dinner', 'full_day_lunch', 'full_day_dinner'] as const;
export type BreakTypeCode = typeof BREAK_TYPES[number];

export const BREAK_TYPE_LABELS: Record<BreakTypeCode, string> = {
  lunch: 'Lunch',
  dinner: 'Dinner',
  full_day_lunch: 'Lunch (Full Day)',
  full_day_dinner: 'Dinner (Full Day)',
};

export interface ShiftBreakDef {
  type: BreakTypeCode;
  label: string;
  accent?: PaletteKey;
}

export function isBreakTypeCode(value: unknown): value is BreakTypeCode {
  return typeof value === 'string' && (BREAK_TYPES as readonly string[]).includes(value);
}

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
    const accent = isPaletteKey(r.accent) ? r.accent : undefined;

    out.push(accent ? { type, label, accent } : { type, label });
  }

  return { ok: true, breaks: out };
}

// ─── Shift codes ──────────────────────────────────────────────────────────────

export const SHIFT_CODES = ['morning', 'evening', 'full_day'] as const;
export type ShiftCode = typeof SHIFT_CODES[number];

export const SHIFT_LABELS: Record<ShiftCode, string> = {
  morning: 'Morning',
  evening: 'Evening',
  full_day: 'Full Day',
};

export function isShiftCode(value: unknown): value is ShiftCode {
  return typeof value === 'string' && (SHIFT_CODES as readonly string[]).includes(value);
}

// ─── Task catalog ─────────────────────────────────────────────────────────────

export const REMOVED_TASK_TYPES = [
  'edc_reconciliation',
  'eod_z_report',
  'open_statement',
] as const;

export type RemovedTaskType = typeof REMOVED_TASK_TYPES[number];

export function isRemovedTaskType(value: unknown): value is RemovedTaskType {
  return typeof value === 'string' && (REMOVED_TASK_TYPES as readonly string[]).includes(value);
}

export const TASK_TYPES = [
  'store_front',
  'store_opening',
  'grooming',
  'setoran',
  'cek_bin',
  'vm_checklist',
  'marketing_check',
  'item_dropping',
  'briefing',
  'serah_terima',
  'store_closing',
] as const;

export type TaskType = typeof TASK_TYPES[number];

export function isTaskType(value: unknown): value is TaskType {
  return typeof value === 'string' && (TASK_TYPES as readonly string[]).includes(value);
}

export interface TaskCatalogEntry {
  code: TaskType;
  label: string;
  description?: string;
  icon: string;
  accent: PaletteKey;
  isPersonal: boolean;
  sortOrder: number;
}

export const TASK_CATALOG: TaskCatalogEntry[] = [
  {
    code: 'store_front',
    label: 'Store Front',
    description: 'Foto tampak depan toko dan rolling door sebelum toko dibuka.',
    icon: 'Store',
    accent: 'sky',
    isPersonal: false,
    sortOrder: 10,
  },
  {
    code: 'store_opening',
    label: 'Store Opening',
    description: 'Checklist pembukaan toko pagi.',
    icon: 'Sunrise',
    accent: 'amber',
    isPersonal: false,
    sortOrder: 20,
  },
  {
    code: 'grooming',
    label: 'Grooming',
    description: 'Checklist grooming per employee.',
    icon: 'UserCheck',
    accent: 'emerald',
    isPersonal: true,
    sortOrder: 30,
  },
  {
    code: 'setoran',
    label: 'Setoran',
    description: 'Pencatatan setoran toko dan carry-forward unpaid.',
    icon: 'Wallet',
    accent: 'emerald',
    isPersonal: false,
    sortOrder: 40,
  },
  {
    code: 'cek_bin',
    label: 'Cek Bin',
    description: 'Sampling pengecekan bin toko.',
    icon: 'Boxes',
    accent: 'slate',
    isPersonal: false,
    sortOrder: 50,
  },
  {
    code: 'vm_checklist',
    label: 'VM Checklist',
    description: 'Checklist visual merchandising toko.',
    icon: 'ClipboardCheck',
    accent: 'violet',
    isPersonal: false,
    sortOrder: 60,
  },
  {
    code: 'marketing_check',
    label: 'Marketing Check',
    description: 'Checklist materi promo dan campaign toko.',
    icon: 'Megaphone',
    accent: 'rose',
    isPersonal: false,
    sortOrder: 70,
  },
  {
    code: 'item_dropping',
    label: 'Receiving',
    description: 'Pencatatan dropping atau receiving barang.',
    icon: 'PackageOpen',
    accent: 'sky',
    isPersonal: false,
    sortOrder: 80,
  },
  {
    code: 'briefing',
    label: 'Briefing',
    description: 'Checklist briefing shift.',
    icon: 'MessagesSquare',
    accent: 'amber',
    isPersonal: false,
    sortOrder: 90,
  },
  {
    code: 'serah_terima',
    label: 'Serah Terima',
    description: 'Catatan serah terima antar shift.',
    icon: 'Repeat',
    accent: 'slate',
    isPersonal: false,
    sortOrder: 100,
  },
  {
    code: 'store_closing',
    label: 'Store Closing',
    description: 'Checklist closing toko: EOD Z-Report, EDC settlement, EDC summary, dan Open Statement.',
    icon: 'MoonStar',
    accent: 'violet',
    isPersonal: false,
    sortOrder: 110,
  },
];

export const TASK_CATALOG_BY_CODE: Record<TaskType, TaskCatalogEntry> = TASK_CATALOG.reduce(
  (acc, task) => {
    acc[task.code] = task;
    return acc;
  },
  {} as Record<TaskType, TaskCatalogEntry>,
);

export const TASK_LABELS: Record<TaskType, string> = TASK_CATALOG.reduce(
  (acc, task) => {
    acc[task.code] = task.label;
    return acc;
  },
  {} as Record<TaskType, string>,
);

export const TASK_ICONS: Record<TaskType, string> = TASK_CATALOG.reduce(
  (acc, task) => {
    acc[task.code] = task.icon;
    return acc;
  },
  {} as Record<TaskType, string>,
);

export const TASK_ACCENTS: Record<TaskType, PaletteKey> = TASK_CATALOG.reduce(
  (acc, task) => {
    acc[task.code] = task.accent;
    return acc;
  },
  {} as Record<TaskType, PaletteKey>,
);

export function getTaskCatalogEntry(code: TaskType): TaskCatalogEntry {
  return TASK_CATALOG_BY_CODE[code];
}

export function taskLabelOf(code: string | null | undefined): string {
  return code && isTaskType(code) ? TASK_LABELS[code] : code ?? '';
}

export function taskAccentOf(code: string | null | undefined): PaletteKey {
  return code && isTaskType(code) ? TASK_ACCENTS[code] : 'slate';
}

export function taskIconOf(code: string | null | undefined): string {
  return code && isTaskType(code) ? TASK_ICONS[code] : 'Circle';
}

export function normalizeTaskCodes(
  input: unknown,
): { ok: true; taskTypes: TaskType[] } | { ok: false; error: string } {
  if (input == null) return { ok: true, taskTypes: [] };
  if (!Array.isArray(input)) return { ok: false, error: 'taskTypes must be an array' };

  const out: TaskType[] = [];
  const seen = new Set<string>();

  for (const value of input) {
    if (isRemovedTaskType(value)) {
      return {
        ok: false,
        error: `task type "${value}" has been removed. Use "store_closing" instead.`,
      };
    }

    if (!isTaskType(value)) {
      return { ok: false, error: `invalid task type "${String(value)}"` };
    }

    if (!seen.has(value)) {
      seen.add(value);
      out.push(value);
    }
  }

  return { ok: true, taskTypes: out };
}

// ─── Default seeded Shift ↔ Task mapping ─────────────────────────────────────
// The runtime employee task page reads from DB (task_definitions + shift_tasks).
// This map is only the default source for scripts/seed-shift-tasks.ts.

export const SHIFT_TASK_MAP: Record<ShiftCode, TaskType[]> = {
  morning: [
    'store_front',
    'store_opening',
    'grooming',
    'setoran',
    'cek_bin',
    'vm_checklist',
    'marketing_check',
    'item_dropping',
    'briefing',
    'serah_terima',
  ],

  evening: [
    'grooming',
    'item_dropping',
    'briefing',
    'serah_terima',
    'store_closing',
  ],

  full_day: [
    'store_front',
    'store_opening',
    'grooming',
    'setoran',
    'cek_bin',
    'vm_checklist',
    'marketing_check',
    'item_dropping',
    'briefing',
    'serah_terima',
    'store_closing',
  ],
};

export function getDefaultTasksForShift(shiftCode: ShiftCode): TaskType[] {
  return [...SHIFT_TASK_MAP[shiftCode]];
}
