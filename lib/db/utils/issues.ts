// lib/db/utils/issues.ts
// ─────────────────────────────────────────────────────────────────────────────
// Server-side helpers for Issue Reports.
//
// This supports:
// - issue.status = draft | reported | in_review | solved | completed
//     draft      → private to reporter, fully editable
//     reported   → sent to assigned roles
//     in_review  → optional: a manager (ops/finance/it/audit) started working it
//     solved     → the reporter resolves it (reachable from reported or in_review)
//     completed  → ops gives final confirmation/closure (only reachable from solved)
//   A one-time Berita Acara (BA) photo upload is available to the reporter at
//   ANY status, including draft, independent of status (see setIssueBaAttachments).
// - multiple destination roles through issue_role_assignments
// - backward compatibility with issues.assignedToRoleId as the primary role
// - Operations visibility scoping:
//     ops_area users see operation-routed issues only for their area
//     ops_ho users see all operation-routed issues
// ─────────────────────────────────────────────────────────────────────────────

import { db } from '@/lib/db';
import {
  employeeTypes,
  issueRoleAssignments,
  issues,
  stores,
  userRoles,
  users,
  type Issue,
} from '@/lib/db/schema';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { createNotificationsForUsers, getOpsUserIdsForArea, getUserIdsForRole } from './notifications';

export type IssueStatus = 'draft' | 'reported' | 'in_review' | 'completed' | 'solved';

export type IssueAssignedRole = {
  id: number;
  code: string;
  label: string;
};

export type SerializedIssue = {
  id: string;
  title: string;
  description: string;
  userId: string;
  storeId: string;
  status: IssueStatus;
  assignedTo: IssueAssignedRole | null;
  assignedToRoles: IssueAssignedRole[];
  reviewedBy: string | null;
  reviewedAt: Date | null;
  attachmentUrls: string[];
  baAttachmentUrls: string[];
  baUploadedBy: string | null;
  baUploadedAt: Date | null;
  solvedBy: string | null;
  solvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateIssueWithRolesInput = {
  title: string;
  description: string;
  userId: string;
  storeId: number;
  assignedToRoleIds: number[];
  status?: IssueStatus;
  attachmentUrls?: string[];
};

const OPS_ROLE_CODES = new Set(['ops', 'operation', 'operations']);

const ISSUE_SELECT = {
  id: issues.id,
  title: issues.title,
  description: issues.description,
  userId: issues.userId,
  storeId: issues.storeId,
  assignedToRoleId: issues.assignedToRoleId,
  status: issues.status,
  attachmentUrls: issues.attachmentUrls,
  baAttachmentUrls: issues.baAttachmentUrls,
  baUploadedBy: issues.baUploadedBy,
  baUploadedAt: issues.baUploadedAt,
  solvedBy: issues.solvedBy,
  solvedAt: issues.solvedAt,
  reviewedBy: issues.reviewedBy,
  reviewedAt: issues.reviewedAt,
  createdAt: issues.createdAt,
  updatedAt: issues.updatedAt,
};

function uniqueNumbers(values: Array<number | string | null | undefined>): number[] {
  return [...new Set(
    values
      .map((v) => Number(v))
      .filter((v) => Number.isInteger(v) && v > 0),
  )];
}

export function parseAttachmentUrls(v: unknown): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v as string[];
  try {
    const parsed = JSON.parse(String(v));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function attachmentJson(urls: string[] | undefined): string | null {
  const clean = (urls ?? []).filter((url) => typeof url === 'string' && url.trim().length > 0);
  return clean.length ? JSON.stringify(clean) : null;
}

export async function getAssignableIssueRoles(): Promise<IssueAssignedRole[]> {
  return db
    .select({ id: userRoles.id, code: userRoles.code, label: userRoles.label })
    .from(userRoles)
    .where(and(eq(userRoles.canReceiveIssues, true), eq(userRoles.isActive, true)))
    .orderBy(asc(userRoles.sortOrder), asc(userRoles.id));
}

export async function validateAssignableRoleIds(roleIds: number[]): Promise<IssueAssignedRole[]> {
  const cleanIds = uniqueNumbers(roleIds);
  if (!cleanIds.length) return [];

  return db
    .select({ id: userRoles.id, code: userRoles.code, label: userRoles.label })
    .from(userRoles)
    .where(
      and(
        inArray(userRoles.id, cleanIds),
        eq(userRoles.canReceiveIssues, true),
        eq(userRoles.isActive, true),
      ),
    )
    .orderBy(asc(userRoles.sortOrder), asc(userRoles.id));
}

export async function getOperationIssueRoleIds(): Promise<number[]> {
  const rows = await getAssignableIssueRoles();
  const opsRows = rows.filter((role) => OPS_ROLE_CODES.has(role.code));
  if (opsRows.length) return opsRows.map((role) => role.id);

  // Safe fallback for older seeds where the operations role might be named
  // differently but is the first role allowed to receive issues.
  return rows.slice(0, 1).map((role) => role.id);
}

export async function replaceIssueRoleAssignments(issueId: number, roleIds: number[]): Promise<void> {
  const cleanIds = uniqueNumbers(roleIds);

  await db
    .delete(issueRoleAssignments)
    .where(eq(issueRoleAssignments.issueId, issueId));

  if (!cleanIds.length) return;

  await db.insert(issueRoleAssignments).values(
    cleanIds.map((roleId) => ({ issueId, roleId })),
  );
}

export async function loadIssueAssignedRoles(issueIds: number[]): Promise<Map<number, IssueAssignedRole[]>> {
  const cleanIds = uniqueNumbers(issueIds);
  const result = new Map<number, IssueAssignedRole[]>();
  if (!cleanIds.length) return result;

  const rows = await db
    .select({
      issueId: issueRoleAssignments.issueId,
      id: userRoles.id,
      code: userRoles.code,
      label: userRoles.label,
    })
    .from(issueRoleAssignments)
    .innerJoin(userRoles, eq(userRoles.id, issueRoleAssignments.roleId))
    .where(inArray(issueRoleAssignments.issueId, cleanIds))
    .orderBy(asc(userRoles.sortOrder), asc(userRoles.id));

  for (const row of rows) {
    const list = result.get(row.issueId) ?? [];
    list.push({ id: row.id, code: row.code, label: row.label });
    result.set(row.issueId, list);
  }

  return result;
}

export function serializeIssue(issue: Issue, assignedRoles: IssueAssignedRole[] = []): SerializedIssue {
  return {
    id: String(issue.id),
    title: issue.title,
    description: issue.description,
    userId: issue.userId,
    storeId: String(issue.storeId),
    status: issue.status as IssueStatus,
    assignedTo: assignedRoles[0] ?? null,
    assignedToRoles: assignedRoles,
    reviewedBy: issue.reviewedBy,
    reviewedAt: issue.reviewedAt,
    attachmentUrls: parseAttachmentUrls(issue.attachmentUrls),
    baAttachmentUrls: parseAttachmentUrls(issue.baAttachmentUrls),
    baUploadedBy: issue.baUploadedBy,
    baUploadedAt: issue.baUploadedAt,
    solvedBy: issue.solvedBy,
    solvedAt: issue.solvedAt,
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
  };
}

export interface IssuePermissionFlags {
  isOwner: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canSendToOps: boolean;
  canMarkSolved: boolean;
  canUploadBa: boolean;
}

/** Computed employee-facing permission flags for a single issue row. */
export function computeIssuePermissionFlags(
  issue: Pick<Issue, 'userId' | 'status' | 'baAttachmentUrls'>,
  userId: string,
): IssuePermissionFlags {
  const isOwner = issue.userId === userId;
  const isDraft = issue.status === 'draft';

  return {
    isOwner,
    canEdit: isOwner && isDraft,
    canDelete: isOwner && isDraft,
    canSendToOps: isOwner && isDraft,
    canMarkSolved: isOwner && (issue.status === 'reported' || issue.status === 'in_review'),
    canUploadBa: isOwner && !parseAttachmentUrls(issue.baAttachmentUrls).length,
  };
}

export async function serializeIssues(rows: Issue[]): Promise<SerializedIssue[]> {
  const roleMap = await loadIssueAssignedRoles(rows.map((row) => row.id));
  return rows.map((row) => serializeIssue(row, roleMap.get(row.id) ?? []));
}

export async function createIssueWithRoles(input: CreateIssueWithRolesInput): Promise<SerializedIssue> {
  const roles = await validateAssignableRoleIds(input.assignedToRoleIds);
  if (!roles.length) throw new Error('Invalid destination.');

  const [issue] = await db
    .insert(issues)
    .values({
      title: input.title,
      description: input.description,
      userId: input.userId,
      storeId: input.storeId,
      assignedToRoleId: roles[0].id,
      status: input.status ?? 'reported',
      attachmentUrls: attachmentJson(input.attachmentUrls),
      updatedAt: new Date(),
    })
    .returning();

  await replaceIssueRoleAssignments(issue.id, roles.map((role) => role.id));

  return serializeIssue(issue, roles);
}

export async function getEmployeeIssues(input: {
  userId: string;
  status?: IssueStatus;
}): Promise<SerializedIssue[]> {
  const conditions = [eq(issues.userId, input.userId)];
  if (input.status) conditions.push(eq(issues.status, input.status));

  const rows = await db
    .select()
    .from(issues)
    .where(and(...conditions))
    .orderBy(desc(issues.createdAt));

  return serializeIssues(rows);
}

export async function updateIssueStatus(input: {
  issueId: number;
  status: IssueStatus;
  reviewedBy: string;
}): Promise<Issue | null> {
  const [updated] = await db
    .update(issues)
    .set({
      status: input.status,
      reviewedBy: input.reviewedBy,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(issues.id, input.issueId))
    .returning();

  return updated ?? null;
}

export async function markIssueSolved(input: {
  issueId: number;
  userId: string;
}): Promise<Issue | null> {
  const [updated] = await db
    .update(issues)
    .set({
      status: 'solved',
      solvedBy: input.userId,
      solvedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(issues.id, input.issueId))
    .returning();

  return updated ?? null;
}

export async function markIssueCompleted(input: {
  issueId: number;
  userId: string;
}): Promise<Issue | null> {
  const [updated] = await db
    .update(issues)
    .set({
      status: 'completed',
      reviewedBy: input.userId,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(issues.id, input.issueId))
    .returning();

  return updated ?? null;
}

export async function setIssueBaAttachments(input: {
  issueId: number;
  userId: string;
  urls: string[];
}): Promise<Issue | null> {
  const json = attachmentJson(input.urls);
  if (!json) return null;

  const [updated] = await db
    .update(issues)
    .set({
      baAttachmentUrls: json,
      baUploadedBy: input.userId,
      baUploadedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(issues.id, input.issueId))
    .returning();

  return updated ?? null;
}

// ─── Notifications ────────────────────────────────────────────────────────────
//
// Every role assigned to receive an issue gets notified through the existing
// generic in-app notifications table. Ops is area-scoped (via the store's
// area, reusing getOpsUserIdsForArea); every other receiving role (finance,
// it, audit, …) is notified as a whole — all its active users, no scoping.

export async function getIssueNotificationRecipients(
  assignedRoles: IssueAssignedRole[],
  storeId: number,
): Promise<string[]> {
  if (!assignedRoles.length) return [];

  const [store] = await db
    .select({ areaId: stores.areaId })
    .from(stores)
    .where(eq(stores.id, storeId))
    .limit(1);

  const recipientSets = await Promise.all(
    assignedRoles.map((role) =>
      OPS_ROLE_CODES.has(role.code)
        ? getOpsUserIdsForArea(store?.areaId ?? null)
        : getUserIdsForRole(role.id),
    ),
  );

  return [...new Set(recipientSets.flat())];
}

export async function notifyIssueEvent(input: {
  issueId: number;
  storeId: number;
  assignedRoles: IssueAssignedRole[];
  type: string;
  title: string;
  body?: string;
  excludeUserId?: string;
}): Promise<void> {
  const recipients = await getIssueNotificationRecipients(input.assignedRoles, input.storeId);
  const userIds = recipients.filter((id) => id !== input.excludeUserId);
  if (!userIds.length) return;

  await createNotificationsForUsers(userIds, {
    type: input.type,
    title: input.title,
    body: input.body,
    link: '/ops/issues',
  });
}

export async function canRoleAccessIssueDestination(input: {
  issueId: number;
  roleIds: number[];
}): Promise<boolean> {
  const cleanRoleIds = uniqueNumbers(input.roleIds);
  if (!cleanRoleIds.length) return false;

  const [row] = await db
    .select({ id: issueRoleAssignments.id })
    .from(issueRoleAssignments)
    .where(
      and(
        eq(issueRoleAssignments.issueId, input.issueId),
        inArray(issueRoleAssignments.roleId, cleanRoleIds),
      ),
    )
    .limit(1);

  return !!row;
}

export async function getOpsVisibleIssues(input: {
  userId: string;
  status?: IssueStatus;
}): Promise<SerializedIssue[]> {
  const [actor] = await db
    .select({
      id: users.id,
      roleId: users.roleId,
      areaId: users.areaId,
      roleCode: userRoles.code,
      employeeTypeCode: employeeTypes.code,
    })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.id, users.roleId))
    .leftJoin(employeeTypes, eq(employeeTypes.id, users.employeeTypeId))
    .where(eq(users.id, input.userId))
    .limit(1);

  if (!actor) return [];

  const statusClause = input.status ? eq(issues.status, input.status) : undefined;

  // Admin/finance/IT and other receiver roles: show issues assigned to their role.
  // Operations gets additional area scoping below.
  const isOpsDestination = OPS_ROLE_CODES.has(actor.roleCode);
  const isOpsHo = actor.employeeTypeCode === 'ops_ho';
  const isOpsArea = actor.employeeTypeCode === 'ops_area';

  const baseConditions = [eq(issueRoleAssignments.roleId, actor.roleId)];
  if (statusClause) baseConditions.push(statusClause);

  const query = db
    .select(ISSUE_SELECT)
    .from(issues)
    .innerJoin(issueRoleAssignments, eq(issueRoleAssignments.issueId, issues.id))
    .innerJoin(stores, eq(stores.id, issues.storeId));

  let rows: Issue[];

  if (isOpsDestination && isOpsArea) {
    rows = await query
      .where(
        and(
          ...baseConditions,
          actor.areaId ? eq(stores.areaId, actor.areaId) : eq(stores.areaId, -1),
        ),
      )
      .orderBy(desc(issues.createdAt)) as Issue[];
  } else if (isOpsDestination && isOpsHo) {
    rows = await query
      .where(and(...baseConditions))
      .orderBy(desc(issues.createdAt)) as Issue[];
  } else if (actor.roleCode === 'it') {
    rows = statusClause
      ? await query.where(statusClause).orderBy(desc(issues.createdAt)) as Issue[]
      : await query.orderBy(desc(issues.createdAt)) as Issue[];
  } else {
    rows = await query
      .where(and(...baseConditions))
      .orderBy(desc(issues.createdAt)) as Issue[];
  }

  // Inner joins can duplicate issues when one issue has multiple matching routes.
  const unique = new Map<number, Issue>();
  for (const issue of rows) unique.set(issue.id, issue);

  return serializeIssues([...unique.values()]);
}
