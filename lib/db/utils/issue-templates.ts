// lib/db/utils/issue-templates.ts
//
// Issue templates ("report presets"): IT keeps a list of common problems with a
// ready title, description and the teams they go to; the employee picks one in
// "Report an Issue" and the form is pre-filled (still editable). CRUD for the IT
// page + the active list the employee form reads.

import { and, asc, eq, ne, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import { issueTemplates, type IssueTemplate } from '@/lib/db/schema';
import { getAssignableIssueRoles } from '@/lib/db/utils/issues';
import {
  ISSUE_DESCRIPTION_MAX,
  ISSUE_TEMPLATE_NAME_MAX,
  ISSUE_TITLE_MAX,
} from '@/lib/issue-templates';

export type TaskResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };

export interface IssueTemplateInput {
  name?: unknown;
  title?: unknown;
  description?: unknown;
  assignedRoleIds?: unknown;
  isActive?: unknown;
}

export async function listIssueTemplates(opts: { activeOnly?: boolean } = {}): Promise<IssueTemplate[]> {
  return db
    .select()
    .from(issueTemplates)
    .where(opts.activeOnly ? eq(issueTemplates.isActive, true) : undefined)
    .orderBy(asc(issueTemplates.sortOrder), asc(issueTemplates.id));
}

type Clean = {
  name?: string;
  title?: string | null;
  description?: string | null;
  assignedRoleIds?: number[];
  isActive?: boolean;
};

async function cleanInput(input: IssueTemplateInput): Promise<TaskResult<Clean>> {
  const out: Clean = {};

  if (input.name !== undefined) {
    const name = typeof input.name === 'string' ? input.name.trim().replace(/\s+/g, ' ') : '';
    if (name.length < 2) return { success: false, error: 'Template name must be at least 2 characters.' };
    if (name.length > ISSUE_TEMPLATE_NAME_MAX) {
      return { success: false, error: `Template name is too long (max ${ISSUE_TEMPLATE_NAME_MAX}).` };
    }
    out.name = name;
  }

  if (input.title !== undefined) {
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    if (title && title.length < 3) return { success: false, error: 'Issue title must be at least 3 characters.' };
    if (title.length > ISSUE_TITLE_MAX) return { success: false, error: `Issue title is too long (max ${ISSUE_TITLE_MAX}).` };
    out.title = title || null;
  }

  if (input.description !== undefined) {
    const description = typeof input.description === 'string' ? input.description.trim() : '';
    if (description.length > ISSUE_DESCRIPTION_MAX) {
      return { success: false, error: `Description is too long (max ${ISSUE_DESCRIPTION_MAX}).` };
    }
    out.description = description || null;
  }

  if (input.assignedRoleIds !== undefined) {
    if (!Array.isArray(input.assignedRoleIds)) return { success: false, error: 'assignedRoleIds must be a list.' };
    const ids = [...new Set(input.assignedRoleIds.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
    const allowed = new Set((await getAssignableIssueRoles()).map((r) => Number(r.id)));
    const bad = ids.filter((id) => !allowed.has(id));
    if (bad.length) return { success: false, error: 'One of the chosen teams cannot receive issues.' };
    out.assignedRoleIds = ids;
  }

  if (input.isActive !== undefined) {
    if (typeof input.isActive !== 'boolean') return { success: false, error: 'isActive must be true or false.' };
    out.isActive = input.isActive;
  }

  return { success: true, data: out };
}

async function nameTaken(name: string, exceptId?: number): Promise<boolean> {
  const [row] = await db
    .select({ id: issueTemplates.id })
    .from(issueTemplates)
    .where(
      and(
        sql`lower(${issueTemplates.name}) = lower(${name})`,
        exceptId != null ? ne(issueTemplates.id, exceptId) : undefined,
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function createIssueTemplate(input: IssueTemplateInput): Promise<TaskResult<IssueTemplate>> {
  const clean = await cleanInput(input);
  if (!clean.success) return clean;
  const { name, title = null, description = null, assignedRoleIds = [], isActive = true } = clean.data;

  if (!name) return { success: false, error: 'Template name is required.' };
  if (!title && !description) return { success: false, error: 'Fill in a title or a description for the template.' };
  if (await nameTaken(name)) return { success: false, error: `Template "${name}" already exists.` };

  // New templates go to the end of the list.
  const [{ maxSort }] = await db
    .select({ maxSort: sql<number>`coalesce(max(${issueTemplates.sortOrder}), 0)::int` })
    .from(issueTemplates);

  const [row] = await db
    .insert(issueTemplates)
    .values({ name, title, description, assignedRoleIds, isActive, sortOrder: maxSort + 10 })
    .onConflictDoNothing({ target: issueTemplates.name })
    .returning();

  if (!row) return { success: false, error: `Template "${name}" already exists.` };
  return { success: true, data: row };
}

export async function updateIssueTemplate(id: number, input: IssueTemplateInput): Promise<TaskResult<IssueTemplate>> {
  const [existing] = await db.select().from(issueTemplates).where(eq(issueTemplates.id, id)).limit(1);
  if (!existing) return { success: false, error: 'Template not found.' };

  const clean = await cleanInput(input);
  if (!clean.success) return clean;
  const patch = clean.data;

  const title = patch.title !== undefined ? patch.title : existing.title;
  const description = patch.description !== undefined ? patch.description : existing.description;
  if (!title && !description) return { success: false, error: 'Fill in a title or a description for the template.' };
  if (patch.name && (await nameTaken(patch.name, id))) {
    return { success: false, error: `Template "${patch.name}" already exists.` };
  }

  const [row] = await db
    .update(issueTemplates)
    .set({
      ...(patch.name ? { name: patch.name } : {}),
      ...(patch.assignedRoleIds ? { assignedRoleIds: patch.assignedRoleIds } : {}),
      ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
      title,
      description,
      updatedAt: new Date(),
    })
    .where(eq(issueTemplates.id, id))
    .returning();

  return { success: true, data: row };
}

export async function deleteIssueTemplate(id: number): Promise<TaskResult> {
  const [row] = await db
    .delete(issueTemplates)
    .where(eq(issueTemplates.id, id))
    .returning({ id: issueTemplates.id });
  if (!row) return { success: false, error: 'Template not found.' };
  return { success: true, data: undefined };
}
