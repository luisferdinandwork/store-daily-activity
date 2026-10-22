// lib/issue-inbox.ts
//
// Pure view logic for the Ops + Finance issue inboxes (/ops/issues,
// /finance/issues): the row type their APIs return, free-text search, the
// status / store / area / period filters, sorting and status counts. The UI is
// components/issues/*. Nothing here changes what an issue may do — statuses and
// who can move them are enforced by the /api/*/issues/[id] routes.

import { STATUS_LABELS } from '@/lib/issues';

export type InboxStatus = 'reported' | 'in_review' | 'solved' | 'completed';

/** Workflow order — also what "Status" sorts by. */
export const INBOX_STATUSES: InboxStatus[] = ['reported', 'in_review', 'solved', 'completed'];

export interface InboxIssue {
  id: string;
  title: string;
  description: string;
  status: InboxStatus;
  attachmentUrls: string[];
  baAttachmentUrls: string[];
  baUploadedAt: string | null;
  solvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  assignedToRoles?: { id: number; code: string; label: string }[];
  store: { id: string; name: string; areaId: string | null; areaName: string | null };
  reporter: { id: string; name: string; nik: string };
}

export const inboxStatusLabel = (s: InboxStatus) => STATUS_LABELS[s];

/** "000123" — the number shown as Ref in the table and drawer. */
export const issueRef = (id: string) => id.padStart(6, '0');

// ─── Filters ─────────────────────────────────────────────────────────────────

export type PeriodKey = 'all' | '7d' | '30d' | 'month';

export const PERIOD_OPTIONS: { key: PeriodKey; label: string }[] = [
  { key: 'all', label: 'Any time' },
  { key: '7d', label: 'Last 7 days' },
  { key: '30d', label: 'Last 30 days' },
  { key: 'month', label: 'This month' },
];

const jakartaMonth = (d: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(d).slice(0, 7);

function inPeriod(iso: string, period: PeriodKey, now: Date): boolean {
  if (period === 'all') return true;
  const at = new Date(iso);
  if (period === 'month') return jakartaMonth(at) === jakartaMonth(now);
  const days = period === '7d' ? 7 : 30;
  return at.getTime() >= now.getTime() - days * 86_400_000;
}

export interface InboxFilters {
  search: string;
  status: InboxStatus | 'all';
  storeId: string; // 'all' | store id
  areaId: string; // 'all' | area id ('' = no area)
  period: PeriodKey;
}

export const DEFAULT_FILTERS: InboxFilters = {
  search: '',
  status: 'all',
  storeId: 'all',
  areaId: 'all',
  period: 'all',
};

/** True while anything other than the status chips narrows the list. */
export const hasActiveFilters = (f: InboxFilters) =>
  f.search.trim() !== '' || f.storeId !== 'all' || f.areaId !== 'all' || f.period !== 'all';

// ─── Search ──────────────────────────────────────────────────────────────────

function haystack(i: InboxIssue): string {
  return [
    i.title,
    i.description,
    i.store.name,
    i.store.areaName ?? '',
    i.reporter.name,
    i.reporter.nik,
    i.id,
    issueRef(i.id),
    inboxStatusLabel(i.status),
  ]
    .join(' ')
    .toLowerCase();
}

/** Every word typed must appear somewhere (title, text, reporter, NIK, store, area, issue no.). */
export function matchesSearch(i: InboxIssue, search: string): boolean {
  const tokens = search
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/^#/, ''))
    .filter(Boolean);
  if (tokens.length === 0) return true;
  const text = haystack(i);
  return tokens.every((t) => text.includes(t));
}

/** Everything except the status chip — so the chip counts show what each would leave. */
export function applyScopeFilters(issues: InboxIssue[], f: InboxFilters, now = new Date()): InboxIssue[] {
  return issues.filter(
    (i) =>
      (f.storeId === 'all' || i.store.id === f.storeId) &&
      (f.areaId === 'all' || (i.store.areaId ?? '') === f.areaId) &&
      inPeriod(i.createdAt, f.period, now) &&
      matchesSearch(i, f.search),
  );
}

export function countByStatus(issues: InboxIssue[]): Record<InboxStatus | 'all', number> {
  const out: Record<InboxStatus | 'all', number> = { all: issues.length, reported: 0, in_review: 0, solved: 0, completed: 0 };
  for (const i of issues) out[i.status] += 1;
  return out;
}

// ─── Sort ────────────────────────────────────────────────────────────────────

export type SortKey = 'created' | 'status' | 'store' | 'reporter' | 'title' | 'ref';
export type SortDir = 'asc' | 'desc';

export const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'created', label: 'Date' },
  { key: 'status', label: 'Status' },
  { key: 'store', label: 'Store' },
  { key: 'reporter', label: 'Reporter' },
  { key: 'title', label: 'Title' },
  { key: 'ref', label: 'Issue no.' },
];

/** Direction a column starts in when first clicked: text A→Z, date newest first. */
export const defaultSortDir = (key: SortKey): SortDir => (key === 'created' || key === 'ref' ? 'desc' : 'asc');

/** What the direction button says for each key ("Newest" reads better than "Descending"). */
export function sortDirLabel(key: SortKey, dir: SortDir): string {
  if (key === 'created' || key === 'ref') return dir === 'desc' ? 'Newest first' : 'Oldest first';
  if (key === 'status') return dir === 'asc' ? 'Reported → Completed' : 'Completed → Reported';
  return dir === 'asc' ? 'A → Z' : 'Z → A';
}

const text = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });

export function sortIssues(issues: InboxIssue[], key: SortKey, dir: SortDir): InboxIssue[] {
  const sign = dir === 'asc' ? 1 : -1;
  const byCreated = (a: InboxIssue, b: InboxIssue) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();

  const cmp = (a: InboxIssue, b: InboxIssue): number => {
    switch (key) {
      case 'created':
        return byCreated(a, b);
      case 'ref':
        return Number(a.id) - Number(b.id);
      case 'status':
        return INBOX_STATUSES.indexOf(a.status) - INBOX_STATUSES.indexOf(b.status);
      case 'store':
        return text(a.store.name, b.store.name);
      case 'reporter':
        return text(a.reporter.name, b.reporter.name);
      case 'title':
        return text(a.title, b.title);
    }
  };

  // Ties fall back to newest first, so a sorted-by-store list is still in a sensible order inside a store.
  return [...issues].sort((a, b) => sign * cmp(a, b) || byCreated(b, a));
}

// ─── Option lists ────────────────────────────────────────────────────────────

export function storeOptions(issues: InboxIssue[]) {
  const m = new Map<string, { id: string; name: string; areaName: string | null }>();
  for (const i of issues) if (!m.has(i.store.id)) m.set(i.store.id, { id: i.store.id, name: i.store.name, areaName: i.store.areaName });
  return [...m.values()].sort((a, b) => text(a.name, b.name));
}

export function areaOptions(issues: InboxIssue[]) {
  const m = new Map<string, string>();
  for (const i of issues) m.set(i.store.areaId ?? '', i.store.areaName ?? 'No area');
  return [...m.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => text(a.name, b.name));
}

// ─── Time ────────────────────────────────────────────────────────────────────

export function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const jakartaYear = (d: Date) =>
  Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric' }).format(d));

/** "19 Oct, 14:30" in Jakarta time (with the year when it isn't this year). */
export function fmtIssueDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-GB', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit',
    month: 'short',
    ...(jakartaYear(d) === jakartaYear(new Date()) ? {} : { year: 'numeric' as const }),
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}
