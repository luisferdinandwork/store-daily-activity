// lib/store-closing-hold.ts
// ─────────────────────────────────────────────────────────────────────────────
// Client-safe rules for the Store Closing "On Hold" report. An Open Statement put
// On Hold becomes an issue for Ops + IT + Finance, so:
//   • the employee must say WHY (the reason), and pick a CATEGORY when IT has set
//     some up (/it/store-closing-hold);
//   • the issue's title + description come from an IT-editable template:
//       – the default template (DEFAULT_HOLD_*_TEMPLATE until IT saves its own);
//       – a category may carry its own description, which wins over the default.
//
// Templates are plain text with {{placeholders}} (HOLD_PLACEHOLDERS). Pure — no
// DB; stored rows are read in lib/db/utils/store-closing-hold.ts.
// ─────────────────────────────────────────────────────────────────────────────

// ─── The reason the employee types ───────────────────────────────────────────

export const HOLD_REASON_MIN = 10;
export const HOLD_REASON_MAX = 1000;

/** Null when the reason is good enough to submit On Hold. */
export function holdReasonProblem(reason: string | null | undefined): string | null {
  const t = (reason ?? '').trim();
  if (t.length === 0) return 'Isi alasan On Hold terlebih dahulu — alasan ini dikirim sebagai issue ke Ops, Finance, dan IT.';
  if (t.length < HOLD_REASON_MIN) return `Alasan On Hold minimal ${HOLD_REASON_MIN} karakter — jelaskan masalahnya.`;
  if (t.length > HOLD_REASON_MAX) return `Alasan On Hold maksimal ${HOLD_REASON_MAX} karakter.`;
  return null;
}

// ─── The category the employee picks ─────────────────────────────────────────

export const HOLD_CATEGORY_NAME_MAX = 60;

/** A category as the employee page gets it (active ones only). */
export interface HoldCategoryOption {
  id: number;
  name: string;
}

/** A category as the IT page gets it. */
export interface HoldCategoryAdminDto extends HoldCategoryOption {
  /** Own issue description template; null = the default template is used. */
  description: string | null;
  isActive: boolean;
  sortOrder: number;
  /** Store Closings that picked it. */
  usageCount: number;
}

/**
 * Null when the category is fine. With no active category (IT has not set any up, or hid
 * them all) the On Hold report simply has none — only when there ARE some must one be picked.
 */
export function holdCategoryProblem(
  categoryId: number | null | undefined,
  active: readonly HoldCategoryOption[],
): string | null {
  if (active.length === 0) return null;
  if (categoryId == null) return 'Pilih kategori On Hold terlebih dahulu.';
  if (!active.some((c) => c.id === categoryId)) return 'Kategori On Hold yang dipilih sudah tidak tersedia — pilih kategori lain.';
  return null;
}

// ─── Issue text templates ────────────────────────────────────────────────────

export const HOLD_TITLE_MAX = 120;
/** Template, before the placeholders are filled in (a 1000-character reason still fits the issue). */
export const HOLD_DESCRIPTION_MAX = 1000;

export interface HoldPlaceholder {
  name: string;
  description: string;
  /** Shown in the IT preview. */
  sample: string;
}

export const HOLD_PLACEHOLDERS: readonly HoldPlaceholder[] = [
  { name: 'store', description: 'Store name', sample: 'Fisik Football - Daan Mogot' },
  { name: 'storeCode', description: 'Store code', sample: 'FF001' },
  { name: 'date', description: 'Date of the Store Closing', sample: '09 Oktober 2026' },
  { name: 'category', description: 'Category the employee picked ("Tidak dikategorikan" when none)', sample: 'Selisih nominal EDC' },
  { name: 'reason', description: 'Reason the employee typed — every description must include it', sample: 'Nominal EDC BCA tidak sama dengan Z-Report, selisih Rp 150.000.' },
  { name: 'employee', description: 'Name of the employee who submitted', sample: 'Budi Santoso' },
];

export type HoldVars = Record<'store' | 'storeCode' | 'date' | 'category' | 'reason' | 'employee', string>;

export const HOLD_SAMPLE_VARS: HoldVars = Object.fromEntries(
  HOLD_PLACEHOLDERS.map((p) => [p.name, p.sample]),
) as HoldVars;

/** What {{category}} says when the report has none. */
export const HOLD_NO_CATEGORY_LABEL = 'Tidak dikategorikan';

export const DEFAULT_HOLD_TITLE_TEMPLATE = 'Open Statement Tertunda - {{store}} - {{date}}';

export const DEFAULT_HOLD_DESCRIPTION_TEMPLATE = [
  'Issue otomatis dari task Store Closing untuk toko {{store}} pada tanggal {{date}}.',
  '',
  'Open Statement dipilih On Hold sehingga task Store Closing belum dapat diselesaikan.',
  '',
  'Kategori: {{category}}',
  'Alasan dari employee: {{reason}}',
  '',
  'Issue ini otomatis dikirim ke tim Operation, Finance, dan IT. Ops Area hanya melihat issue dari area toko ini, sedangkan Ops HO dapat melihat seluruh issue Operation.',
  '',
  'Setelah issue diselesaikan (Completed), task Store Closing terkait akan dibuka kembali agar employee bisa menyelesaikan Open Statement.',
].join('\n');

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g;
const KNOWN = new Set(HOLD_PLACEHOLDERS.map((p) => p.name));

/** Every `{{name}}` used in a piece of template text. */
export function holdPlaceholdersUsed(text: string): string[] {
  return [...new Set([...text.matchAll(PLACEHOLDER_RE)].map((m) => m[1]))];
}

/** The template with `vars` filled in (one pass — a value that itself contains `{{x}}` stays as typed). */
export function renderHoldTemplate(template: string, vars: HoldVars): string {
  return template.replace(PLACEHOLDER_RE, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? vars[name as keyof HoldVars] : whole,
  );
}

/**
 * Null when `text` may be saved as a title / description template. A description must
 * include {{reason}} — otherwise an edit could silently drop what the employee wrote.
 */
export function holdTemplateProblem(kind: 'title' | 'description', text: string): string | null {
  const t = text.trim();
  const label = kind === 'title' ? 'Title' : 'Description';
  if (!t) return `${label} is required.`;

  const max = kind === 'title' ? HOLD_TITLE_MAX : HOLD_DESCRIPTION_MAX;
  if (t.length > max) return `${label} is too long (max ${max} characters).`;
  if (kind === 'title' && /[\r\n]/.test(t)) return 'The title must be a single line.';

  const unknown = holdPlaceholdersUsed(t).filter((name) => !KNOWN.has(name));
  if (unknown.length > 0) {
    return `Unknown placeholder${unknown.length > 1 ? 's' : ''}: ${unknown.map((n) => `{{${n}}}`).join(', ')}.`;
  }
  if (kind === 'description' && !holdPlaceholdersUsed(t).includes('reason')) {
    return 'The description must include {{reason}} so Ops sees what the employee wrote.';
  }
  return null;
}

/** The title + description of the issue: the category's own description, else the default one. */
export function buildHoldIssueText(opts: {
  titleTemplate: string;
  descriptionTemplate: string;
  /** The picked category's own description (null / blank = use the default). */
  categoryDescription?: string | null;
  vars: HoldVars;
}): { title: string; description: string } {
  const own = opts.categoryDescription?.trim();
  return {
    title: renderHoldTemplate(opts.titleTemplate, opts.vars).replace(/\s+/g, ' ').trim(),
    description: renderHoldTemplate(own ? own : opts.descriptionTemplate, opts.vars).trim(),
  };
}

// ─── Starter set (one click on the IT page when no category exists yet) ──────

export const STARTER_HOLD_CATEGORIES: readonly { name: string; description: string | null }[] = [
  {
    name: 'Selisih nominal EDC / Z-Report',
    description: [
      'Open Statement toko {{store}} tanggal {{date}} ditahan karena ada selisih antara nominal EDC dan Z-Report.',
      '',
      'Kategori: {{category}}',
      'Penjelasan dari {{employee}}: {{reason}}',
      '',
      'Finance mohon cek rekap EDC dan Z-Report toko ini. Setelah issue diselesaikan (Completed), task Store Closing akan dibuka kembali agar employee bisa menyelesaikan Open Statement.',
    ].join('\n'),
  },
  {
    name: 'Selisih kas / Sales Cash',
    description: [
      'Open Statement toko {{store}} tanggal {{date}} ditahan karena ada selisih pada kas / Sales Cash.',
      '',
      'Kategori: {{category}}',
      'Penjelasan dari {{employee}}: {{reason}}',
      '',
      'Ops dan Finance mohon telusuri selisih kas toko ini. Setelah issue diselesaikan (Completed), task Store Closing akan dibuka kembali.',
    ].join('\n'),
  },
  {
    name: 'Kendala sistem / POS / Business Central',
    description: [
      'Open Statement toko {{store}} tanggal {{date}} ditahan karena kendala sistem (POS / Business Central).',
      '',
      'Kategori: {{category}}',
      'Penjelasan dari {{employee}}: {{reason}}',
      '',
      'IT mohon cek kendala ini. Setelah issue diselesaikan (Completed), task Store Closing akan dibuka kembali agar employee bisa menyelesaikan Open Statement.',
    ].join('\n'),
  },
  { name: 'Lainnya', description: null },
];
