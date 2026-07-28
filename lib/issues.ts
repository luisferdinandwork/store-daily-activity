// lib/issues.ts
// Client-side utilities for the issue report feature.

export type IssueStatus = 'draft' | 'reported' | 'in_review' | 'completed' | 'solved';

/** A department/role an employee can route an issue to (ops, finance, it, …). */
export interface AssignableRole {
  id:          number;
  code:        string;
  label:       string;
  description: string | null;
}

export interface Issue {
  id:             string;
  title:          string;
  description:    string;
  userId:         string;
  storeId:        string;
  status:         IssueStatus;

  /** Backward-compatible primary destination. */
  assignedTo:     { id: number; code: string; label: string } | null;

  /** New multi-role destinations. */
  assignedToRoles: Array<{ id: number; code: string; label: string; description?: string | null }>;

  reviewedBy:     string | null;
  reviewedAt:     string | null;
  attachmentUrls: string[];
  createdAt:      string;
  updatedAt:      string;

  /** One-time Berita Acara evidence upload, available any time after "reported". */
  baAttachmentUrls: string[];
  baUploadedBy:     string | null;
  baUploadedAt:     string | null;

  /** Reporter self-declares the issue fixed before Ops confirms "completed". */
  solvedBy: string | null;
  solvedAt: string | null;

  /** Store visibility helpers returned by the employee issue API. */
  isOwner?:       boolean;
  canEdit?:       boolean;
  canDelete?:     boolean;
  canSendToOps?:  boolean;
  canMarkSolved?: boolean;
  canUploadBa?:   boolean;
}

export interface CreateIssuePayload {
  title: string;
  description: string;

  /** New multi-role assignment. */
  assignedToRoleIds?: number[];

  /** Backward-compatible fallback. */
  assignedToRoleId?: number;

  storeName?: string;
  attachmentUrls?: string[];

  /** Manual issue page defaults to reported; Store Closing can create draft. */
  status?: IssueStatus;
}

export interface UpdateIssuePayload {
  title?: string;
  description?: string;
  attachmentUrls?: string[];
  baAttachmentUrls?: string[];
  assignedToRoleIds?: number[];
  assignedToRoleId?: number;
  status?: IssueStatus;
}

// ─── Status helpers ───────────────────────────────────────────────────────────

export const STATUS_LABELS: Record<IssueStatus, string> = {
  draft:     'Draft',
  reported:  'Reported',
  in_review: 'In Review',
  completed: 'Completed',
  solved:    'Solved',
};

export const STATUS_COLORS: Record<IssueStatus, { bg: string; text: string; dot: string }> = {
  draft:     { bg: 'bg-slate-500/10',   text: 'text-slate-500',   dot: 'bg-slate-500'   },
  reported:  { bg: 'bg-amber-500/10',   text: 'text-amber-500',   dot: 'bg-amber-500'   },
  in_review: { bg: 'bg-blue-500/10',    text: 'text-blue-500',    dot: 'bg-blue-500'    },
  completed: { bg: 'bg-emerald-500/10', text: 'text-emerald-500', dot: 'bg-emerald-500' },
  solved:    { bg: 'bg-violet-500/10',  text: 'text-violet-500',  dot: 'bg-violet-500'  },
};

// ─── API helpers ──────────────────────────────────────────────────────────────

export async function fetchAssignableRoles(): Promise<AssignableRole[]> {
  const res = await fetch('/api/issues/assignable-roles', { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to load destinations');
  const data = await res.json();
  return (data.roles ?? []) as AssignableRole[];
}

function parseUrls(v: unknown): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v as string[];
  try {
    const parsed = JSON.parse(v as string);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normaliseIssue(raw: any): Issue {
  const assignedToRoles = Array.isArray(raw.assignedToRoles)
    ? raw.assignedToRoles
    : raw.assignedTo
      ? [raw.assignedTo]
      : [];

  return {
    ...raw,
    id: String(raw.id),
    storeId: String(raw.storeId),
    assignedTo: raw.assignedTo ?? assignedToRoles[0] ?? null,
    assignedToRoles,
    attachmentUrls: parseUrls(raw.attachmentUrls),
    baAttachmentUrls: parseUrls(raw.baAttachmentUrls),
  } as Issue;
}

export async function fetchIssues(status?: IssueStatus): Promise<Issue[]> {
  const url = status
    ? `/api/employee/issues?status=${status}`
    : '/api/employee/issues';

  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to fetch issues');
  const data = await res.json();

  return (data.issues as any[]).map(normaliseIssue);
}

export async function createIssue(payload: CreateIssuePayload): Promise<Issue> {
  const res = await fetch('/api/employee/issues', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error ?? 'Failed to submit issue');
  }

  const data = await res.json();
  return normaliseIssue(data.issue);
}

export async function updateIssue(id: string, payload: UpdateIssuePayload): Promise<Issue> {
  const res = await fetch(`/api/employee/issues/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error ?? 'Failed to update issue');
  }

  const data = await res.json();
  return normaliseIssue(data.issue);
}

export async function sendDraftIssue(id: string): Promise<Issue> {
  return updateIssue(id, { status: 'reported' });
}

export async function markIssueSolved(id: string): Promise<Issue> {
  return updateIssue(id, { status: 'solved' });
}

export async function deleteIssue(id: string): Promise<void> {
  const res = await fetch(`/api/employee/issues/${id}`, { method: 'DELETE' });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error ?? 'Failed to delete issue');
  }
}

export async function uploadIssueImages(
  files: File[],
  title?: string,
  storeName?: string,
): Promise<string[]> {
  if (!files.length) return [];

  const form = new FormData();
  for (const file of files) {
    form.append('files', file);
  }
  if (title) form.append('title', title);
  if (storeName) form.append('storeName', storeName);

  const res = await fetch('/api/upload/issue', { method: 'POST', body: form });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error ?? 'Failed to upload images');
  }

  const { urls } = await res.json();
  return urls as string[];
}

/**
 * Uploads Berita Acara (BA) evidence files — unlike `uploadIssueImages`
 * (camera-only photos), these are picked from the device's gallery/file
 * system and may be images OR documents (PDF, Word, Excel).
 */
export async function uploadBaFiles(
  files: File[],
  title?: string,
  storeName?: string,
): Promise<string[]> {
  if (!files.length) return [];

  const form = new FormData();
  for (const file of files) {
    form.append('files', file);
  }
  if (title) form.append('title', title);
  if (storeName) form.append('storeName', storeName);

  const res = await fetch('/api/upload/issue-ba', { method: 'POST', body: form });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error ?? 'Failed to upload Berita Acara');
  }

  const { urls } = await res.json();
  return urls as string[];
}

export function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);

  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;

  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}
