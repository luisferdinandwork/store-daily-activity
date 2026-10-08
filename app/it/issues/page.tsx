'use client';

// app/it/issues/page.tsx — IT issue overview (desktop)
//
// Every issue in the system, drafts included, whoever it's routed to (GET
// /api/it/issues). IT can send any draft (e.g. a Store Closing On Hold draft
// its store never sent) and review / complete the issues routed to IT; the
// rest are view-only here (PATCH /api/it/issues/[id]).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  ArrowRight, Inbox, Loader2, Lock, Search, Send, Shield, X,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { STATUS_LABELS, type IssueStatus } from '@/lib/issues';
import { StoreCombobox } from '@/components/shared/store-combobox';
import { IssueAttachments } from '@/components/shared/IssueAttachments';
import OpsPageHeader from '@/components/ops/layout/OpsPageHeader';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AssignedIssueRole {
  id: number;
  code: string;
  label: string;
}

interface ItIssue {
  id: string;
  title: string;
  description: string;
  status: IssueStatus;
  attachmentUrls: string[];
  baAttachmentUrls: string[];
  baUploadedAt: string | null;
  solvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  reviewedAt: string | null;
  reviewedByName: string | null;
  assignedToRoles: AssignedIssueRole[];
  routedToIt: boolean;
  isStoreClosingHold: boolean;
  store: { id: string; storeNo: string; name: string; areaId: string | null; areaName: string | null };
  reporter: { id: string; name: string; nik: string };
}

type StatusFilter = IssueStatus | 'all';

// ─── Status look ──────────────────────────────────────────────────────────────

const STATUS_ORDER: IssueStatus[] = ['draft', 'reported', 'in_review', 'solved', 'completed'];

const STATUS_STYLE: Record<IssueStatus, { badge: string; dot: string }> = {
  draft:     { badge: 'bg-slate-100 text-slate-600',     dot: 'bg-slate-400'   },
  reported:  { badge: 'bg-amber-50 text-amber-700',      dot: 'bg-amber-500'   },
  in_review: { badge: 'bg-blue-50 text-blue-700',        dot: 'bg-blue-500'    },
  solved:    { badge: 'bg-violet-50 text-violet-700',    dot: 'bg-violet-500'  },
  completed: { badge: 'bg-emerald-50 text-emerald-700',  dot: 'bg-emerald-500' },
};

function StatusBadge({ status }: { status: IssueStatus }) {
  const s = STATUS_STYLE[status];
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-medium', s.badge)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', s.dot)} />
      {STATUS_LABELS[status]}
    </span>
  );
}

function RoleChips({ roles }: { roles: AssignedIssueRole[] }) {
  if (!roles.length) return <span className="text-slate-400">—</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {roles.map((r) => (
        <span key={r.id} className="rounded border border-slate-200 bg-white px-1.5 py-px text-[10px] font-medium text-slate-600">
          {r.label}
        </span>
      ))}
    </span>
  );
}

function HoldTag() {
  return (
    <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-px text-[10px] font-medium text-amber-700 ring-1 ring-inset ring-amber-200">
      <Lock className="h-2.5 w-2.5" />
      Store Closing hold
    </span>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function refNo(id: string): string {
  return `#${id.padStart(6, '0')}`;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    timeZone: 'Asia/Jakarta',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    timeZone: 'Asia/Jakarta',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

/** The one action IT can take on this issue right now, if any. */
function nextAction(issue: ItIssue): { status: IssueStatus; label: string } | null {
  if (issue.status === 'draft') return { status: 'reported', label: 'Send to assigned teams' };
  if (!issue.routedToIt) return null;
  if (issue.status === 'reported') return { status: 'in_review', label: 'Start review' };
  if (issue.status === 'solved') return { status: 'completed', label: 'Mark complete' };
  return null;
}

// ─── Detail drawer ────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[104px_1fr] gap-3 py-1.5">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="min-w-0 text-xs text-slate-800">{children}</dd>
    </div>
  );
}

function IssueDrawer({ issue, onClose, onAction, updating }: {
  issue: ItIssue;
  onClose: () => void;
  onAction: (issue: ItIssue, next: IssueStatus) => void;
  updating: boolean;
}) {
  const action = nextAction(issue);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex" onClick={onClose}>
      <div className="flex-1 bg-slate-900/30" />
      <aside
        className="flex w-[440px] max-w-full flex-col border-l border-slate-200 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
        aria-label={`Issue ${refNo(issue.id)}`}
      >
        {/* Header */}
        <div className="flex items-start gap-3 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[11px] text-slate-400">{refNo(issue.id)}</p>
            <h2 className="mt-0.5 text-sm font-semibold leading-snug text-slate-900">{issue.title}</h2>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <StatusBadge status={issue.status} />
              {issue.isStoreClosingHold && <HoldTag />}
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <dl className="divide-y divide-slate-100">
            <Field label="Routed to"><RoleChips roles={issue.assignedToRoles} /></Field>
            <Field label="Store">
              <span className="font-medium">{issue.store.storeNo}</span> · {issue.store.name}
            </Field>
            <Field label="Area">{issue.store.areaName ?? '—'}</Field>
            <Field label="Reporter">
              {issue.reporter.name} <span className="text-slate-400">· {issue.reporter.nik}</span>
            </Field>
            <Field label="Created">{formatDateTime(issue.createdAt)}</Field>
            {issue.reviewedAt && (
              <Field label="Reviewed">
                {formatDateTime(issue.reviewedAt)}
                {issue.reviewedByName && <span className="text-slate-400"> · {issue.reviewedByName}</span>}
              </Field>
            )}
            {issue.solvedAt && <Field label="Solved">{formatDateTime(issue.solvedAt)}</Field>}
          </dl>

          {issue.isStoreClosingHold && issue.status !== 'completed' && (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
              A Store Closing task is On Hold until this issue is completed. Anyone in the store can
              send or solve it; completing it reopens the task.
            </p>
          )}

          <section>
            <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Description</h3>
            <p className="whitespace-pre-wrap text-xs leading-relaxed text-slate-700">{issue.description}</p>
          </section>

          <IssueAttachments
            compact
            title={issue.title}
            attachmentUrls={issue.attachmentUrls}
            baAttachmentUrls={issue.baAttachmentUrls}
            baUploadedLabel={issue.baUploadedAt ? `Uploaded ${formatDate(issue.baUploadedAt)}` : null}
          />
        </div>

        {/* Footer */}
        <div className="border-t border-slate-200 px-5 py-3">
          {action ? (
            <button
              onClick={() => onAction(issue, action.status)}
              disabled={updating}
              className="flex h-9 w-full items-center justify-center gap-2 rounded-md bg-slate-900 text-xs font-medium text-white transition-colors hover:bg-slate-800 disabled:opacity-60"
            >
              {updating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <>
                  {action.status === 'reported' ? <Send className="h-3.5 w-3.5" /> : null}
                  {action.label}
                  {action.status !== 'reported' ? <ArrowRight className="h-3.5 w-3.5" /> : null}
                </>
              )}
            </button>
          ) : (
            <p className="text-center text-[11px] text-slate-400">
              {issue.status === 'completed'
                ? 'Closed — no further action.'
                : issue.routedToIt
                  ? issue.status === 'in_review'
                    ? 'Waiting for the store to mark it solved.'
                    : 'No action needed from IT.'
                  : 'Not routed to IT — view only.'}
            </p>
          )}
        </div>
      </aside>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ItIssuesPage() {
  const { data: session, status: authStatus } = useSession();
  const router = useRouter();
  const isIt = session?.user?.role === 'it';

  const [issuesList, setIssuesList] = useState<ItIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [storeFilter, setStoreFilter] = useState<number | null>(null);
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    if (authStatus === 'loading') return;
    if (!session) { router.replace('/login'); return; }
    if (!isIt) router.replace('/');
  }, [authStatus, session, isIt, router]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/it/issues', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data?.error ?? 'Failed to load issues.');
      setIssuesList(data.issues ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load issues.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (isIt) void load(); }, [isIt, load]);

  // Stores and destinations that appear in the data, for the filters.
  const stores = useMemo(() => {
    const m = new Map<number, { id: number; storeNo: string; name: string }>();
    for (const i of issuesList) m.set(Number(i.store.id), { id: Number(i.store.id), storeNo: i.store.storeNo, name: i.store.name });
    return [...m.values()].sort((a, b) => a.storeNo.localeCompare(b.storeNo, undefined, { numeric: true }));
  }, [issuesList]);

  const roles = useMemo(() => {
    const m = new Map<string, string>();
    for (const i of issuesList) for (const r of i.assignedToRoles) m.set(r.code, r.label);
    return [...m.entries()].map(([code, label]) => ({ code, label }));
  }, [issuesList]);

  // Store + destination + search narrow the list; the status tabs count within that.
  const scoped = useMemo(() => {
    const q = query.trim().toLowerCase();
    return issuesList.filter((i) => {
      if (storeFilter != null && Number(i.store.id) !== storeFilter) return false;
      if (roleFilter !== 'all' && !i.assignedToRoles.some((r) => r.code === roleFilter)) return false;
      if (!q) return true;
      return [i.title, i.description, i.store.name, i.store.storeNo, i.reporter.name, i.reporter.nik, refNo(i.id)]
        .some((v) => v.toLowerCase().includes(q));
    });
  }, [issuesList, storeFilter, roleFilter, query]);

  const counts = useMemo(() => {
    const c: Record<StatusFilter, number> = { all: scoped.length, draft: 0, reported: 0, in_review: 0, solved: 0, completed: 0 };
    for (const i of scoped) c[i.status]++;
    return c;
  }, [scoped]);

  const visible = useMemo(
    () => (statusFilter === 'all' ? scoped : scoped.filter((i) => i.status === statusFilter)),
    [scoped, statusFilter],
  );

  const selected = useMemo(
    () => issuesList.find((i) => i.id === selectedId) ?? null,
    [issuesList, selectedId],
  );

  async function handleAction(issue: ItIssue, next: IssueStatus) {
    setUpdating(true);
    try {
      const res = await fetch(`/api/it/issues/${issue.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data?.error ?? 'Update failed.');
      toast.success(next === 'reported' ? `${refNo(issue.id)} sent.` : `${refNo(issue.id)} updated.`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed.');
    } finally {
      setUpdating(false);
    }
  }

  if (authStatus === 'loading' || !session) return (
    <div className="flex min-h-full items-center justify-center bg-slate-50">
      <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
    </div>
  );

  if (!isIt) return (
    <div className="flex min-h-full flex-col items-center justify-center gap-3 bg-slate-50 p-8 text-center">
      <Shield className="h-7 w-7 text-red-500" />
      <p className="text-sm font-semibold text-slate-800">Access restricted</p>
      <p className="text-xs text-slate-500">Only IT can view all issue reports.</p>
    </div>
  );

  const drafts = issuesList.filter((i) => i.status === 'draft').length;
  const open = issuesList.filter((i) => i.status !== 'completed' && i.status !== 'draft').length;
  const tabs: StatusFilter[] = ['all', ...STATUS_ORDER];

  return (
    <div className="min-h-full bg-slate-50">
      <OpsPageHeader
        scope="IT · Support"
        title="Issues"
        subtitle={loading && !issuesList.length
          ? 'Loading…'
          : `${issuesList.length} total · ${open} open · ${drafts} draft${drafts !== 1 ? 's' : ''} — every store, every destination`}
        onRefresh={() => void load()}
        refreshing={loading}
      />

      <div className="mx-auto max-w-7xl space-y-3 px-4 py-5 sm:px-6 lg:px-8">
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search title, store, reporter, NIK or ref…"
              className="h-9 w-full rounded-md border border-slate-200 bg-white pl-8 pr-3 text-xs text-slate-800 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none"
            />
          </div>
          <div className="w-full sm:w-64">
            <StoreCombobox
              stores={stores}
              value={storeFilter}
              onChange={setStoreFilter}
              allLabel="All stores"
              className="max-w-none"
            />
          </div>
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="h-9 rounded-md border border-slate-200 bg-white px-2.5 text-xs text-slate-700 focus:border-slate-400 focus:outline-none"
            aria-label="Routed to"
          >
            <option value="all">All destinations</option>
            {roles.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
          </select>
        </div>

        {/* Table */}
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          {/* Status tabs */}
          <div className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-slate-200 px-2">
            {tabs.map((t) => {
              const active = statusFilter === t;
              return (
                <button
                  key={t}
                  onClick={() => setStatusFilter(t)}
                  className={cn(
                    '-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-2.5 py-2.5 text-xs font-medium transition-colors',
                    active ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-700',
                  )}
                >
                  {t === 'all' ? 'All' : STATUS_LABELS[t]}
                  <span className={cn('rounded px-1 text-[10px] tabular-nums', active ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500')}>
                    {counts[t]}
                  </span>
                </button>
              );
            })}
          </div>

          {loading && !issuesList.length ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
            </div>
          ) : visible.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-16 text-center">
              <Inbox className="h-6 w-6 text-slate-300" />
              <p className="text-xs font-medium text-slate-600">No issues match these filters</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] text-left text-xs">
                <thead className="bg-slate-50 text-[11px] text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">Ref</th>
                    <th className="px-3 py-2 font-medium">Issue</th>
                    <th className="px-3 py-2 font-medium">Store</th>
                    <th className="px-3 py-2 font-medium">Reporter</th>
                    <th className="px-3 py-2 font-medium">Routed to</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 text-right font-medium">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visible.map((i) => (
                    <tr
                      key={i.id}
                      onClick={() => setSelectedId(i.id)}
                      className={cn(
                        'cursor-pointer align-top transition-colors hover:bg-slate-50',
                        selectedId === i.id && 'bg-slate-50',
                      )}
                    >
                      <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[11px] text-slate-400">{refNo(i.id)}</td>
                      <td className="max-w-[340px] px-3 py-2.5">
                        <p className="truncate font-medium text-slate-900">{i.title}</p>
                        <p className="mt-0.5 truncate text-[11px] text-slate-500">{i.description}</p>
                        {i.isStoreClosingHold && <span className="mt-1 inline-block"><HoldTag /></span>}
                      </td>
                      <td className="px-3 py-2.5">
                        <p className="whitespace-nowrap font-medium text-slate-800">{i.store.storeNo}</p>
                        <p className="max-w-[180px] truncate text-[11px] text-slate-500">{i.store.name}</p>
                      </td>
                      <td className="px-3 py-2.5">
                        <p className="max-w-[160px] truncate text-slate-800">{i.reporter.name}</p>
                        <p className="text-[11px] text-slate-500">{i.reporter.nik}</p>
                      </td>
                      <td className="px-3 py-2.5"><RoleChips roles={i.assignedToRoles} /></td>
                      <td className="px-3 py-2.5"><StatusBadge status={i.status} /></td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right">
                        <p className="text-slate-700">{formatDate(i.createdAt)}</p>
                        <p className="text-[11px] text-slate-400">{relativeTime(i.createdAt)}</p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {!loading && (
          <p className="px-1 text-[11px] text-slate-400">
            Showing {visible.length} of {issuesList.length}. IT can send any draft, and review or complete issues routed to IT.
          </p>
        )}
      </div>

      {selected && (
        <IssueDrawer
          issue={selected}
          updating={updating}
          onAction={handleAction}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}
