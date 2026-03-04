// lib/issues.ts
// Client-side utilities for the issue report feature.

export type IssueStatus = 'reported' | 'in_review' | 'resolved';

export interface Issue {
  id:             string;
  title:          string;
  description:    string;
  userId:         string;
  storeId:        string;
  status:         IssueStatus;
  reviewedBy:     string | null;
  reviewedAt:     string | null;
  // Stored as a JSON string in DB; deserialized to string[] by the API helpers.
  attachmentUrls: string[];
  createdAt:      string;
  updatedAt:      string;
}

export interface CreateIssuePayload {
  title:          string;
  description:    string;
  storeName?:     string; // passed through to the upload helper for filename generation
  attachmentUrls?: string[];
}

// ─── Status helpers ───────────────────────────────────────────────────────────

export const STATUS_LABELS: Record<IssueStatus, string> = {
  reported:  'Reported',
  in_review: 'In Review',
  resolved:  'Resolved',
};

export const STATUS_COLORS: Record<IssueStatus, { bg: string; text: string; dot: string }> = {
  reported:  { bg: 'bg-amber-500/10',  text: 'text-amber-500',  dot: 'bg-amber-500'  },
  in_review: { bg: 'bg-blue-500/10',   text: 'text-blue-500',   dot: 'bg-blue-500'   },
  resolved:  { bg: 'bg-emerald-500/10',text: 'text-emerald-500',dot: 'bg-emerald-500' },
};

// ─── API helpers ──────────────────────────────────────────────────────────────

/**
 * Fetch the current user's issues.
 * Pass a status string to filter (e.g. 'reported').
 */
export async function fetchIssues(status?: IssueStatus): Promise<Issue[]> {
  const url = status
    ? `/api/employee/issues?status=${status}`
    : '/api/employee/issues';

  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to fetch issues');
  const data = await res.json();

  // The DB stores attachmentUrls as a JSON string — deserialize each row.
  return (data.issues as any[]).map(issue => ({
    ...issue,
    attachmentUrls: issue.attachmentUrls
      ? (typeof issue.attachmentUrls === 'string'
          ? JSON.parse(issue.attachmentUrls)
          : issue.attachmentUrls)
      : [],
  })) as Issue[];
}

/**
 * Submit a new issue report.
 * `attachmentUrls` should be pre-uploaded URLs (e.g. from your storage bucket).
 */
export async function createIssue(payload: CreateIssuePayload): Promise<Issue> {
  const res = await fetch('/api/employee/issues', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error ?? 'Failed to submit issue');
  }

  const data = await res.json();
  return data.issue as Issue;
}

/**
 * Upload all issue-report images in a single multipart request.
 * Files are saved to /public/issue-report/<title>_<store>_<date>_<n>.<ext>
 *
 * @param files     - Image files selected by the employee (max 5)
 * @param title     - Issue title  (used in filename)
 * @param storeName - Store name   (used in filename)
 */
export async function uploadIssueImages(
  files:      File[],
  title?:     string,
  storeName?: string,
): Promise<string[]> {
  if (!files.length) return [];

  // Send all files in a single request using the 'files' field name
  const form = new FormData();
  for (const file of files) {
    form.append('files', file);       // 'files' — server calls getAll('files')
  }
  if (title)     form.append('title',     title);
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
 * Format a date string to a human-readable relative time.
 * e.g. "2 hours ago", "3 days ago"
 */
export function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);

  if (mins  < 1)  return 'just now';
  if (mins  < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days  < 7)  return `${days}d ago`;

  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day:   'numeric',
  });
}