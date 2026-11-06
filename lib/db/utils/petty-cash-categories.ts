// lib/db/utils/petty-cash-categories.ts
//
// Petty cash request categories (STATIONERY & OFFICE SUPPLIES, PRINTING, …) —
// CRUD for the IT management page, plus the lookup the employee request form
// uses. A category has a Pengertian + Contoh Pengeluaran (for the "!" help sheet)
// and no preset Keterangan — the PIC always writes their own.
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import {
  pettyCashCategories,
  pettyCashTransactions,
  type PettyCashCategory,
} from '@/lib/db/schema';
import {
  PETTY_CASH_CATEGORY_NAME_MAX,
  PETTY_CASH_CATEGORY_TEXT_MAX,
} from '@/lib/petty-cash-categories';

export type TaskResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };

export interface PettyCashCategoryInput {
  name?: unknown;
  definition?: unknown;
  examples?: unknown;
  isActive?: unknown;
}

export interface PettyCashCategoryWithUsage extends PettyCashCategory {
  /** Requests recorded under this category (all time). */
  usageCount: number;
}

export async function listPettyCashCategories(
  opts: { activeOnly?: boolean } = {},
): Promise<PettyCashCategory[]> {
  return db
    .select()
    .from(pettyCashCategories)
    .where(opts.activeOnly ? eq(pettyCashCategories.isActive, true) : undefined)
    .orderBy(asc(pettyCashCategories.sortOrder), asc(pettyCashCategories.id));
}

export async function listPettyCashCategoriesWithUsage(): Promise<PettyCashCategoryWithUsage[]> {
  const [rows, usage] = await Promise.all([
    listPettyCashCategories(),
    db
      .select({
        categoryId: pettyCashTransactions.categoryId,
        n: sql<number>`count(*)::int`,
      })
      .from(pettyCashTransactions)
      .groupBy(pettyCashTransactions.categoryId),
  ]);
  const usageById = new Map(usage.map((u) => [u.categoryId, u.n]));
  return rows.map((r) => ({ ...r, usageCount: usageById.get(r.id) ?? 0 }));
}

export async function getPettyCashCategory(id: number): Promise<PettyCashCategory | null> {
  const [row] = await db
    .select()
    .from(pettyCashCategories)
    .where(eq(pettyCashCategories.id, id))
    .limit(1);
  return row ?? null;
}

// ─── Validation ───────────────────────────────────────────────────────────────

type CleanFields = {
  name?: string;
  definition?: string | null;
  examples?: string | null;
  isActive?: boolean;
};

function cleanInput(input: PettyCashCategoryInput): TaskResult<CleanFields> {
  const out: CleanFields = {};

  if (input.name !== undefined) {
    const name = typeof input.name === 'string' ? input.name.trim().replace(/\s+/g, ' ') : '';
    if (name.length < 2) return { success: false, error: 'Nama kategori minimal 2 karakter.' };
    if (name.length > PETTY_CASH_CATEGORY_NAME_MAX) {
      return { success: false, error: `Nama kategori maksimal ${PETTY_CASH_CATEGORY_NAME_MAX} karakter.` };
    }
    out.name = name;
  }

  for (const [key, label] of [['definition', 'Pengertian'], ['examples', 'Contoh pengeluaran']] as const) {
    const raw = input[key];
    if (raw === undefined) continue;
    const text = typeof raw === 'string' ? raw.trim() : '';
    if (text.length > PETTY_CASH_CATEGORY_TEXT_MAX) {
      return { success: false, error: `${label} maksimal ${PETTY_CASH_CATEGORY_TEXT_MAX} karakter.` };
    }
    out[key] = text || null;
  }

  if (input.isActive !== undefined) {
    if (typeof input.isActive !== 'boolean') {
      return { success: false, error: 'isActive must be a boolean.' };
    }
    out.isActive = input.isActive;
  }

  return { success: true, data: out };
}

async function nameTaken(name: string, exceptId?: number): Promise<boolean> {
  const [row] = await db
    .select({ id: pettyCashCategories.id })
    .from(pettyCashCategories)
    .where(
      and(
        sql`lower(${pettyCashCategories.name}) = lower(${name})`,
        exceptId != null ? ne(pettyCashCategories.id, exceptId) : undefined,
      ),
    )
    .limit(1);
  return Boolean(row);
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export async function createPettyCashCategory(
  input: PettyCashCategoryInput,
): Promise<TaskResult<PettyCashCategory>> {
  const clean = cleanInput(input);
  if (!clean.success) return clean;
  const { name, definition = null, examples = null, isActive = true } = clean.data;

  if (!name) return { success: false, error: 'Nama kategori wajib diisi.' };
  if (await nameTaken(name)) return { success: false, error: `Kategori "${name}" sudah ada.` };

  // New categories go to the end of the list.
  const [{ maxSort }] = await db
    .select({ maxSort: sql<number>`coalesce(max(${pettyCashCategories.sortOrder}), 0)::int` })
    .from(pettyCashCategories);

  const [row] = await db
    .insert(pettyCashCategories)
    .values({
      name,
      definition,
      examples,
      isActive,
      sortOrder: maxSort + 10,
    })
    .onConflictDoNothing({ target: pettyCashCategories.name })
    .returning();

  if (!row) return { success: false, error: `Kategori "${name}" sudah ada.` };
  return { success: true, data: row };
}

export async function updatePettyCashCategory(
  id: number,
  input: PettyCashCategoryInput,
): Promise<TaskResult<PettyCashCategory>> {
  const existing = await getPettyCashCategory(id);
  if (!existing) return { success: false, error: 'Kategori tidak ditemukan.' };

  const clean = cleanInput(input);
  if (!clean.success) return clean;
  const patch = clean.data;

  if (patch.name && (await nameTaken(patch.name, id))) {
    return { success: false, error: `Kategori "${patch.name}" sudah ada.` };
  }

  const [row] = await db
    .update(pettyCashCategories)
    .set({
      ...(patch.name ? { name: patch.name } : {}),
      ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
      ...(patch.definition !== undefined ? { definition: patch.definition } : {}),
      ...(patch.examples !== undefined ? { examples: patch.examples } : {}),
      updatedAt: new Date(),
    })
    .where(eq(pettyCashCategories.id, id))
    .returning();

  return { success: true, data: row };
}

/**
 * Hard delete. Past requests keep their `categoryName` snapshot (the FK is
 * ON DELETE SET NULL), so history still reads correctly.
 */
export async function deletePettyCashCategory(id: number): Promise<TaskResult> {
  const [row] = await db
    .delete(pettyCashCategories)
    .where(eq(pettyCashCategories.id, id))
    .returning({ id: pettyCashCategories.id });
  if (!row) return { success: false, error: 'Kategori tidak ditemukan.' };
  return { success: true, data: undefined };
}

/** Rewrite sort order from the given id order (10, 20, 30, …) in one statement. */
export async function reorderPettyCashCategories(ids: number[]): Promise<TaskResult> {
  const unique = [...new Set(ids)].filter((n) => Number.isInteger(n) && n > 0);
  if (unique.length === 0) return { success: false, error: 'No categories to reorder.' };

  const cases = sql.join(
    unique.map((id, i) => sql`when ${id}::int then ${(i + 1) * 10}::int`),
    sql` `,
  );
  await db
    .update(pettyCashCategories)
    .set({
      sortOrder: sql`case ${pettyCashCategories.id} ${cases} else ${pettyCashCategories.sortOrder} end`,
      updatedAt: new Date(),
    })
    .where(inArray(pettyCashCategories.id, unique));

  return { success: true, data: undefined };
}
