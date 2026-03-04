'use client';

// app/ops/issues/page.tsx

import { useState, useEffect, useCallback } from 'react';
import {
  AlertTriangle,
  Store,
  MapPin,
  Clock,
  User,
  ChevronDown,
  CheckCircle2,
  Eye,
  Loader2,
  X,
  ArrowRight,
  Filter,
  RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

type IssueStatus = 'reported' | 'in_review' | 'resolved';

interface OpsIssue {
  id:             string;
  title:          string;
  description:    string;
  status:         IssueStatus;
  attachmentUrls: string[];
  createdAt:      string;
  updatedAt:      string;
  reviewedAt:     string | null;
  reviewedBy:     string | null;
  store: {
    id:       string;
    name:     string;
    areaId:   string | null;
    areaName: string | null;
  };
  reporter: {
    id:    string;
    name:  string;
    email: string;
  };
}

interface Meta {
  total:     number;
  reported:  number;
  in_review: number;
  resolved:  number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<IssueStatus, {
  label:   string;
  bg:      string;
  text:    string;
  dot:     string;
  border:  string;
  action:  string;
  next:    IssueStatus | null;
}> = {
  reported: {
    label:  'Reported',
    bg:     'bg-amber-500/10',
    text:   'text-amber-600 dark:text-amber-400',
    dot:    'bg-amber-500',
    border: 'border-amber-500/20',
    action: 'Start Review',
    next:   'in_review',
  },
  in_review: {
    label:  'In Review',
    bg:     'bg-blue-500/10',
    text:   'text-blue-600 dark:text-blue-500',
    dot:    'bg-blue-500',
    border: 'border-blue-500/20',
    action: 'Mark Resolved',
    next:   'resolved',
  },
  resolved: {
    label:  'Resolved',
    bg:     'bg-emerald-500/10',
    text:   'text-emerald-600 dark:text-emerald-500',
    dot:    'bg-emerald-500',
    border: 'border-emerald-500/20',
    action: '',
    next:   null,
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(dateStr: string): string {
  const diff  = Date.now() - new Date(dateStr).getTime();
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);
  if (mins  < 1)  return 'just now';
  if (mins  < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days  < 7)  return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: IssueStatus }) {
  const c = STATUS_CONFIG[status];
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold', c.bg, c.text)}>
      <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', c.dot)} />
      {c.label}
    </span>
  );
}

// ─── Summary Cards ────────────────────────────────────────────────────────────

function SummaryCards({ meta, filter, onFilter }: {
  meta:     Meta;
  filter:   IssueStatus | 'all';
  onFilter: (v: IssueStatus | 'all') => void;
}) {
  const cards = [
    { key: 'all'      as const, label: 'Total',     value: meta.total,     color: 'text-foreground',     bg: 'bg-muted/60'        },
    { key: 'reported' as const, label: 'Reported',  value: meta.reported,  color: 'text-amber-500',      bg: 'bg-amber-500/8'     },
    { key: 'in_review'as const, label: 'In Review', value: meta.in_review, color: 'text-blue-500',       bg: 'bg-blue-500/8'      },
    { key: 'resolved' as const, label: 'Resolved',  value: meta.resolved,  color: 'text-emerald-500',    bg: 'bg-emerald-500/8'   },
  ];

  return (
    <div className="grid grid-cols-4 gap-3">
      {cards.map(c => (
        <button
          key={c.key}
          onClick={() => onFilter(c.key)}
          className={cn(
            'flex flex-col gap-1 rounded-xl border p-3 text-left transition-all hover:shadow-sm',
            filter === c.key
              ? 'border-primary/40 ring-1 ring-primary/20 shadow-sm'
              : 'border-border hover:border-border/80',
            c.bg,
          )}
        >
          <span className={cn('text-2xl font-bold tabular-nums', c.color)}>{c.value}</span>
          <span className="text-[11px] font-semibold text-muted-foreground">{c.label}</span>
        </button>
      ))}
    </div>
  );
}

// ─── Issue Detail Panel ───────────────────────────────────────────────────────

function IssueDetailPanel({
  issue,
  onClose,
  onStatusChange,
}: {
  issue:          OpsIssue;
  onClose:        () => void;
  onStatusChange: (id: string, status: IssueStatus) => Promise<void>;
}) {
  const [updating, setUpdating] = useState(false);
  const cfg = STATUS_CONFIG[issue.status];

  const handleAdvance = async () => {
    if (!cfg.next) return;
    setUpdating(true);
    try {
      await onStatusChange(issue.id, cfg.next);
    } finally {
      setUpdating(false);
    }
  };

  const STEPS: IssueStatus[] = ['reported', 'in_review', 'resolved'];
  const currentIdx = STEPS.indexOf(issue.status);

  return (
    <div className="flex h-full flex-col">

      {/* Panel header */}
      <div className="flex items-start justify-between border-b border-border px-6 py-5">
        <div className="flex-1 min-w-0 pr-4">
          <div className="flex items-center gap-2 mb-1.5">
            <StatusBadge status={issue.status} />
            <span className="text-xs text-muted-foreground">{relativeTime(issue.createdAt)}</span>
          </div>
          <h2 className="font-semibold text-foreground text-base leading-snug">{issue.title}</h2>
        </div>
        <button
          onClick={onClose}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground hover:bg-muted/80 transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

        {/* Progress */}
        <div className="flex items-center gap-1">
          {STEPS.map((step, i) => {
            const done = i <= currentIdx;
            const isLast = i === STEPS.length - 1;
            return (
              <div key={step} className="flex flex-1 items-center gap-1">
                <div className={cn(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold border-2 transition-colors',
                  done ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground',
                )}>
                  {done ? <CheckCircle2 className="h-3 w-3" /> : i + 1}
                </div>
                <span className={cn('text-[10px] font-semibold whitespace-nowrap', done ? 'text-primary' : 'text-muted-foreground')}>
                  {STATUS_CONFIG[step].label}
                </span>
                {!isLast && (
                  <div className={cn('flex-1 h-px mx-1', i < currentIdx ? 'bg-primary' : 'bg-border')} />
                )}
              </div>
            );
          })}
        </div>

        {/* Context: store + area */}
        <div className={cn('rounded-xl border p-4 space-y-3', cfg.border, cfg.bg)}>
          <div className="flex items-center gap-2">
            <Store className={cn('h-4 w-4 shrink-0', cfg.text)} />
            <div>
              <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-widest">Store</p>
              <p className="text-sm font-semibold text-foreground">{issue.store.name}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <MapPin className={cn('h-4 w-4 shrink-0', cfg.text)} />
            <div>
              <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-widest">Area</p>
              <p className="text-sm font-semibold text-foreground">{issue.store.areaName ?? '—'}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <User className={cn('h-4 w-4 shrink-0', cfg.text)} />
            <div>
              <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-widest">Reported by</p>
              <p className="text-sm font-semibold text-foreground">{issue.reporter.name}</p>
              <p className="text-[11px] text-muted-foreground">{issue.reporter.email}</p>
            </div>
          </div>
        </div>

        {/* Description */}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">Description</p>
          <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap rounded-xl border border-border bg-muted/30 p-4">
            {issue.description}
          </p>
        </div>

        {/* Attachment images */}
        {issue.attachmentUrls && issue.attachmentUrls.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
              Photos ({issue.attachmentUrls.length})
            </p>
            <div className="grid grid-cols-3 gap-2">
              {issue.attachmentUrls.map((url, i) => (
                <a
                  key={i}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group relative block aspect-square overflow-hidden rounded-xl border border-border bg-muted transition-all hover:border-primary/40 hover:shadow-sm"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={url}
                    alt={`Attachment ${i + 1}`}
                    className="h-full w-full object-cover transition-transform group-hover:scale-105"
                  />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/10" />
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Reviewed info */}
        {issue.reviewedAt && (
          <div className="flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
            <Eye className="h-4 w-4 text-emerald-500 shrink-0" />
            <p className="text-xs text-emerald-600 dark:text-emerald-400">
              Reviewed {relativeTime(issue.reviewedAt)}
            </p>
          </div>
        )}

        {/* Ref */}
        <p className="text-center text-[11px] text-muted-foreground/40">
          Ref: {issue.id.slice(0, 8).toUpperCase()}
        </p>
      </div>

      {/* Action footer */}
      {cfg.next && (
        <div className="border-t border-border px-6 py-4">
          <button
            onClick={handleAdvance}
            disabled={updating}
            className={cn(
              'flex w-full items-center justify-center gap-2 rounded-xl py-3 font-semibold text-sm transition-all active:scale-[0.98] disabled:opacity-60',
              issue.status === 'reported'
                ? 'bg-blue-500 text-white hover:bg-blue-600'
                : 'bg-emerald-500 text-white hover:bg-emerald-600',
            )}
          >
            {updating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                {cfg.action}
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Issue Row ────────────────────────────────────────────────────────────────

function IssueRow({ issue, selected, onClick }: {
  issue:    OpsIssue;
  selected: boolean;
  onClick:  () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'group w-full rounded-xl border p-4 text-left transition-all hover:shadow-sm',
        selected
          ? 'border-primary/50 bg-primary/5 shadow-sm'
          : 'border-border bg-card hover:border-border/60',
      )}
    >
      <div className="flex items-start justify-between gap-3 mb-2.5">
        <p className="font-semibold text-sm text-foreground leading-snug line-clamp-1">{issue.title}</p>
        <StatusBadge status={issue.status} />
      </div>

      <p className="text-xs text-muted-foreground line-clamp-2 mb-3 leading-relaxed">
        {issue.description}
      </p>

      <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <Store className="h-3 w-3" />
          {issue.store.name}
        </span>
        <span className="flex items-center gap-1">
          <MapPin className="h-3 w-3" />
          {issue.store.areaName ?? 'Unknown'}
        </span>
        <span className="flex items-center gap-1 ml-auto">
          <Clock className="h-3 w-3" />
          {relativeTime(issue.createdAt)}
        </span>
      </div>
    </button>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function OpsIssuesPage() {
  const [issuesList, setIssuesList] = useState<OpsIssue[]>([]);
  const [meta,       setMeta]       = useState<Meta>({ total: 0, reported: 0, in_review: 0, resolved: 0 });
  const [loading,    setLoading]    = useState(true);
  const [filter,     setFilter]     = useState<IssueStatus | 'all'>('all');
  const [storeFilter,setStoreFilter]= useState<string>('all');
  const [selected,   setSelected]   = useState<OpsIssue | null>(null);

  // Collect unique stores from loaded issues
  const storeOptions = Array.from(
    new Map(issuesList.map(i => [i.store.id, i.store.name])).entries(),
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filter !== 'all')      params.set('status',  filter);
      if (storeFilter !== 'all') params.set('storeId', storeFilter);

      const res  = await fetch(`/api/ops/issues?${params}`, { cache: 'no-store' });
      const data = await res.json();
      setIssuesList(data.issues ?? []);
      setMeta(data.meta ?? { total: 0, reported: 0, in_review: 0, resolved: 0 });
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [filter, storeFilter]);

  useEffect(() => { load(); }, [load]);

  const handleStatusChange = async (id: string, status: IssueStatus) => {
    const res = await fetch(`/api/ops/issues/${id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ status }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.error ?? 'Failed to update');
    }

    const { issue: updated } = await res.json();

    // The PATCH endpoint returns a flat DB row (no nested store/reporter).
    // Only merge the scalar fields that actually change — keep the rich
    // nested shape that was loaded on page init.
    const scalarPatch = {
      status:     updated.status     as IssueStatus,
      reviewedAt: updated.reviewedAt as string | null,
      reviewedBy: updated.reviewedBy as string | null,
      updatedAt:  updated.updatedAt  as string,
    };

    setIssuesList(prev =>
      prev.map(i => i.id === id ? { ...i, ...scalarPatch } : i),
    );
    setSelected(prev =>
      prev?.id === id ? { ...prev, ...scalarPatch } : prev,
    );
  };

  // Reload without filter reset — just refresh data
  const handleRefresh = () => load();

  return (
    <div className="flex h-screen overflow-hidden bg-background">

      {/* ── Left panel ── */}
      <div className={cn(
        'flex flex-col border-r border-border bg-card transition-all',
        selected ? 'w-[55%]' : 'w-full',
      )}>

        {/* Header */}
        <div className="border-b border-border px-6 py-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-lg font-bold text-foreground">Issue Reports</h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                Showing issues from your area
              </p>
            </div>
            <button
              onClick={handleRefresh}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </button>
          </div>

          {/* Summary cards */}
          <SummaryCards meta={meta} filter={filter} onFilter={v => { setFilter(v); setSelected(null); }} />
        </div>

        {/* Filter bar */}
        <div className="flex items-center gap-3 border-b border-border px-6 py-3">
          <Filter className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-xs text-muted-foreground font-medium">Store:</span>
          <div className="relative">
            <select
              value={storeFilter}
              onChange={e => { setStoreFilter(e.target.value); setSelected(null); }}
              className="appearance-none rounded-lg border border-border bg-background py-1.5 pl-3 pr-7 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
            >
              <option value="all">All Stores</option>
              {storeOptions.map(([id, name]) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
          </div>

          <span className="ml-auto text-xs text-muted-foreground tabular-nums">
            {issuesList.length} issue{issuesList.length !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Issues list */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2.5">
          {loading ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : issuesList.length === 0 ? (
            <div className="flex h-40 flex-col items-center justify-center gap-2 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
                <AlertTriangle className="h-5 w-5 text-muted-foreground/50" />
              </div>
              <p className="text-sm font-semibold text-foreground">No issues found</p>
              <p className="text-xs text-muted-foreground">
                {filter !== 'all' ? `No ${STATUS_CONFIG[filter as IssueStatus].label.toLowerCase()} issues in your area.` : 'Your area is all clear.'}
              </p>
            </div>
          ) : (
            issuesList.map(issue => (
              <IssueRow
                key={issue.id}
                issue={issue}
                selected={selected?.id === issue.id}
                onClick={() => setSelected(prev => prev?.id === issue.id ? null : issue)}
              />
            ))
          )}
        </div>
      </div>

      {/* ── Right detail panel ── */}
      {selected && (
        <div className="w-[45%] shrink-0 overflow-hidden border-l border-border bg-card">
          <IssueDetailPanel
            issue={selected}
            onClose={() => setSelected(null)}
            onStatusChange={handleStatusChange}
          />
        </div>
      )}
    </div>
  );
}