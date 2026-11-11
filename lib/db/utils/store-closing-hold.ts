// lib/db/utils/store-closing-hold.ts
//
// Store Closing "On Hold" setup, kept by IT at /it/store-closing-hold:
//   • the default title + description template of the issue an On Hold Open Statement
//     sends to Ops / Finance / IT (no row = the built-in text in lib/store-closing-hold.ts);
//   • the categories an employee picks from, each optionally with its own description.
// The rules (placeholders, limits, rendering) are client-safe in lib/store-closing-hold.ts.

import { and, asc, eq, ne, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import {
  storeClosingHoldCategories,
  storeClosingHoldTemplate,
  storeClosingTasks,
  users,
  type StoreClosingHoldCategory,
} from '@/lib/db/schema';
import {
  DEFAULT_HOLD_DESCRIPTION_TEMPLATE,
  DEFAULT_HOLD_TITLE_TEMPLATE,
  HOLD_CATEGORY_NAME_MAX,
  holdTemplateProblem,
  type HoldCategoryAdminDto,
  type HoldCategoryOption,
} from '@/lib/store-closing-hold';

export type TaskResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };

// ─── Default template ────────────────────────────────────────────────────────

export interface HoldTemplateState {
  title: string;
  description: string;
  /** false = IT has not saved its own; the built-in text is in use. */
  isCustom: boolean;
  updatedAt: string | null;
  updatedByName: string | null;
}

/** What the submit path needs. Never throws — an unreadable table means the built-in text. */
export async function getHoldTemplate(): Promise<HoldTemplateState> {
  try {
    const [row] = await db
      .select({
        title: storeClosingHoldTemplate.title,
        description: storeClosingHoldTemplate.description,
        updatedAt: storeClosingHoldTemplate.updatedAt,
        updatedByName: users.name,
      })
      .from(storeClosingHoldTemplate)
      .leftJoin(users, eq(users.id, storeClosingHoldTemplate.updatedBy))
      .where(eq(storeClosingHoldTemplate.id, 1))
      .limit(1);
    if (row) {
      return {
        title: row.title,
        description: row.description,
        isCustom: true,
        updatedAt: row.updatedAt.toISOString(),
        updatedByName: row.updatedByName ?? null,
      };
    }
  } catch (err) {
    console.error('[store-closing-hold] reading the template failed — using the built-in text', err);
  }
  return {
    title: DEFAULT_HOLD_TITLE_TEMPLATE,
    description: DEFAULT_HOLD_DESCRIPTION_TEMPLATE,
    isCustom: false,
    updatedAt: null,
    updatedByName: null,
  };
}

export async function saveHoldTemplate(
  userId: string,
  input: { title?: unknown; description?: unknown },
): Promise<TaskResult<HoldTemplateState>> {
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  const description = typeof input.description === 'string' ? input.description.replace(/\r\n/g, '\n').trim() : '';

  const titleProblem = holdTemplateProblem('title', title);
  if (titleProblem) return { success: false, error: titleProblem };
  const descriptionProblem = holdTemplateProblem('description', description);
  if (descriptionProblem) return { success: false, error: descriptionProblem };

  const now = new Date();
  await db
    .insert(storeClosingHoldTemplate)
    .values({ id: 1, title, description, updatedBy: userId, updatedAt: now })
    .onConflictDoUpdate({
      target: storeClosingHoldTemplate.id,
      set: { title, description, updatedBy: userId, updatedAt: now },
    });

  return { success: true, data: await getHoldTemplate() };
}

/** Back to the built-in text. */
export async function resetHoldTemplate(): Promise<TaskResult<HoldTemplateState>> {
  await db.delete(storeClosingHoldTemplate).where(eq(storeClosingHoldTemplate.id, 1));
  return { success: true, data: await getHoldTemplate() };
}

// ─── Categories ──────────────────────────────────────────────────────────────

/** The categories an employee can pick (active, in IT's order). Never throws. */
export async function listActiveHoldCategories(): Promise<HoldCategoryOption[]> {
  try {
    return await db
      .select({ id: storeClosingHoldCategories.id, name: storeClosingHoldCategories.name })
      .from(storeClosingHoldCategories)
      .where(eq(storeClosingHoldCategories.isActive, true))
      .orderBy(asc(storeClosingHoldCategories.sortOrder), asc(storeClosingHoldCategories.id));
  } catch (err) {
    // An unreadable list must not stop a store from closing — it just has no categories.
    console.error('[store-closing-hold] reading the categories failed — none offered', err);
    return [];
  }
}

export async function getHoldCategory(id: number): Promise<StoreClosingHoldCategory | null> {
  const [row] = await db
    .select()
    .from(storeClosingHoldCategories)
    .where(eq(storeClosingHoldCategories.id, id))
    .limit(1);
  return row ?? null;
}

/** Every category (hidden ones too) with how many closings picked it — the IT list. */
export async function listHoldCategoriesAdmin(): Promise<HoldCategoryAdminDto[]> {
  const [rows, usage] = await Promise.all([
    db
      .select()
      .from(storeClosingHoldCategories)
      .orderBy(asc(storeClosingHoldCategories.sortOrder), asc(storeClosingHoldCategories.id)),
    db
      .select({
        categoryId: storeClosingTasks.openStatementHoldCategoryId,
        n: sql<number>`count(*)::int`,
      })
      .from(storeClosingTasks)
      .where(sql`${storeClosingTasks.openStatementHoldCategoryId} is not null`)
      .groupBy(storeClosingTasks.openStatementHoldCategoryId),
  ]);
  const used = new Map(usage.map((u) => [u.categoryId, u.n]));

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    isActive: r.isActive,
    sortOrder: r.sortOrder,
    usageCount: used.get(r.id) ?? 0,
  }));
}

export interface HoldCategoryInput {
  name?: unknown;
  description?: unknown;
  isActive?: unknown;
}

type Clean = { name?: string; description?: string | null; isActive?: boolean };

function cleanCategory(input: HoldCategoryInput): TaskResult<Clean> {
  const out: Clean = {};

  if (input.name !== undefined) {
    const name = typeof input.name === 'string' ? input.name.trim().replace(/\s+/g, ' ') : '';
    if (name.length < 2) return { success: false, error: 'Category name must be at least 2 characters.' };
    if (name.length > HOLD_CATEGORY_NAME_MAX) {
      return { success: false, error: `Category name is too long (max ${HOLD_CATEGORY_NAME_MAX}).` };
    }
    out.name = name;
  }

  if (input.description !== undefined) {
    const description = typeof input.description === 'string' ? input.description.replace(/\r\n/g, '\n').trim() : '';
    if (description) {
      const problem = holdTemplateProblem('description', description);
      if (problem) return { success: false, error: problem };
    }
    out.description = description || null; // blank = use the default template
  }

  if (input.isActive !== undefined) {
    if (typeof input.isActive !== 'boolean') return { success: false, error: 'isActive must be true or false.' };
    out.isActive = input.isActive;
  }

  return { success: true, data: out };
}

async function nameTaken(name: string, exceptId?: number): Promise<boolean> {
  const [row] = await db
    .select({ id: storeClosingHoldCategories.id })
    .from(storeClosingHoldCategories)
    .where(
      and(
        sql`lower(${storeClosingHoldCategories.name}) = lower(${name})`,
        exceptId != null ? ne(storeClosingHoldCategories.id, exceptId) : undefined,
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function createHoldCategory(input: HoldCategoryInput): Promise<TaskResult<StoreClosingHoldCategory>> {
  const clean = cleanCategory(input);
  if (!clean.success) return clean;
  const { name, description = null, isActive = true } = clean.data;

  if (!name) return { success: false, error: 'Category name is required.' };
  if (await nameTaken(name)) return { success: false, error: `Category "${name}" already exists.` };

  // New categories go to the end of the list.
  const [{ maxSort }] = await db
    .select({ maxSort: sql<number>`coalesce(max(${storeClosingHoldCategories.sortOrder}), 0)::int` })
    .from(storeClosingHoldCategories);

  const [row] = await db
    .insert(storeClosingHoldCategories)
    .values({ name, description, isActive, sortOrder: maxSort + 10 })
    .onConflictDoNothing({ target: storeClosingHoldCategories.name })
    .returning();

  if (!row) return { success: false, error: `Category "${name}" already exists.` };
  return { success: true, data: row };
}

export async function updateHoldCategory(
  id: number,
  input: HoldCategoryInput,
): Promise<TaskResult<StoreClosingHoldCategory>> {
  const existing = await getHoldCategory(id);
  if (!existing) return { success: false, error: 'Category not found.' };

  const clean = cleanCategory(input);
  if (!clean.success) return clean;
  const patch = clean.data;

  if (patch.name && (await nameTaken(patch.name, id))) {
    return { success: false, error: `Category "${patch.name}" already exists.` };
  }

  const [row] = await db
    .update(storeClosingHoldCategories)
    .set({
      ...(patch.name ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
      updatedAt: new Date(),
    })
    .where(eq(storeClosingHoldCategories.id, id))
    .returning();

  return { success: true, data: row };
}

/** Closings that picked it keep its name (they store a copy); only the link is cleared. */
export async function deleteHoldCategory(id: number): Promise<TaskResult> {
  const [row] = await db
    .delete(storeClosingHoldCategories)
    .where(eq(storeClosingHoldCategories.id, id))
    .returning({ id: storeClosingHoldCategories.id });
  if (!row) return { success: false, error: 'Category not found.' };
  return { success: true, data: undefined };
}

/** `ids` = every category, in the new order. */
export async function reorderHoldCategories(ids: unknown): Promise<TaskResult> {
  if (!Array.isArray(ids) || ids.length === 0) return { success: false, error: 'ids must be a list.' };
  const list = ids.map(Number);
  if (list.some((n) => !Number.isInteger(n) || n <= 0) || new Set(list).size !== list.length) {
    return { success: false, error: 'ids must be unique category ids.' };
  }

  const existing = await db.select({ id: storeClosingHoldCategories.id }).from(storeClosingHoldCategories);
  if (existing.length !== list.length || existing.some((e) => !list.includes(e.id))) {
    return { success: false, error: 'The list is out of date — reload the page.' };
  }

  await Promise.all(
    list.map((id, i) =>
      db
        .update(storeClosingHoldCategories)
        .set({ sortOrder: (i + 1) * 10 })
        .where(eq(storeClosingHoldCategories.id, id)),
    ),
  );
  return { success: true, data: undefined };
}
