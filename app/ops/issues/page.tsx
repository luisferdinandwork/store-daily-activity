'use client';

// app/ops/issues/page.tsx — OPS issue inbox (desktop)
//
// Mirrors the Schedule Manager look: slate canvas, indigo accents, rounded-2xl
// white cards, clickable stat cards, an area-grouped store dropdown for HO, and
// a single right-side slide-in drawer for the issue detail / follow-up.
//
// Scope is enforced server-side (/api/ops/issues): Ops HO sees every Ops-routed
// issue; an area Ops sees only issues from stores in their area.

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  AlertTriangle, Store as StoreIcon, MapPin, Clock, User, ChevronDown,
  CheckCircle2, Eye, Loader2, X, ArrowRight, Globe2,
  AlertCircle, Shield, FileText,
} from 'lucide-react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import OpsPageHeader from '@/components/ops/layout/OpsPageHeader';

// ─── Types ────────────────────────────────────────────────────────────────────

type IssueStatus = 'reported' | 'in_review' | 'completed' | 'solved';

interface AssignedIssueRole {
  id: number;
  code: string;
  label: string;
}

interface OpsIssue {
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
  reviewedBy: string | null;
  assignedToRoles?: AssignedIssueRole[];
  store: { id: string; name: string; areaId: string | null; areaName: string | null };
  reporter: { id: string; name: string; nik: string };
}

// ─── Status config ──────────────────────────────────────────────────────────

const STATUS_CFG: Record<IssueStatus, {
  label: string; accent: string; Icon: typeof AlertCircle;
  next: IssueStatus | null; action: string;
}> = {
  reported:  { label: 'Reported',  accent: '#f59e0b', Icon: AlertCircle,  next: 'in_review', action: 'Start Review'   },
  in_review: { label: 'In Review', accent: '#3b82f6', Icon: Eye,          next: null,        action: ''               },
  solved:    { label: 'Solved',    accent: '#8b5cf6', Icon: CheckCircle2, next: 'completed', action: 'Mark Complete'  },
  completed: { label: 'Completed', accent: '#10b981', Icon: CheckCircle2, next: null,        action: ''               },
};

const STEPS: IssueStatus[] = ['reported', 'in_review', 'solved', 'completed'];

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

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: IssueStatus }) {
  const c = STATUS_CFG[status];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold"
      style={{ background: c.accent + '18', color: c.accent }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: c.accent }} />
      {c.label}
    </span>
  );
}

// ─── Issue detail drawer (right side, consistent with Schedule) ───────────────

function IssueDrawer({ issue, onClose, onAdvance, updating }: {
  issue:    OpsIssue;
  onClose:  () => void;
  onAdvance:(id: string, next: IssueStatus) => void;
  updating: boolean;
}) {
  const cfg = STATUS_CFG[issue.status];
  const currentIdx = STEPS.indexOf(issue.status);

  return (
    <div className="fixed inset-0 z-50 flex" onClick={onClose}>
      <div className="flex-1 bg-slate-900/50 backdrop-blur-sm" />
      <div
        className="flex w-[440px] max-w-full flex-col overflow-hidden bg-white shadow-2xl"
        style={{ animation: 'slideInRight 0.25s ease-out' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="border-b border-slate-100 px-6 py-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <StatusBadge status={issue.status} />
                <span className="text-[11px] text-slate-400">{relativeTime(issue.createdAt)}</span>
              </div>
              <p className="mt-1.5 text-lg font-bold leading-snug text-slate-900">{issue.title}</p>
            </div>
            <button onClick={onClose} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-400 hover:bg-slate-200">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Progress */}
          <div className="flex items-center gap-1">
            {STEPS.map((step, i) => {
              const done = i <= currentIdx;
              const isLast = i === STEPS.length - 1;
              return (
                <div key={step} className="flex flex-1 items-center gap-1">
                  <div
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-[10px] font-bold transition-colors"
                    style={{
                      borderColor: done ? STATUS_CFG[step].accent : '#e2e8f0',
                      background:  done ? STATUS_CFG[step].accent : 'white',
                      color:       done ? 'white' : '#94a3b8',
                    }}
                  >
                    {done ? <CheckCircle2 className="h-3 w-3" /> : i + 1}
                  </div>
                  <span className="whitespace-nowrap text-[10px] font-bold" style={{ color: done ? STATUS_CFG[step].accent : '#94a3b8' }}>
                    {STATUS_CFG[step].label}
                  </span>
                  {!isLast && <div className="mx-1 h-px flex-1" style={{ background: i < currentIdx ? STATUS_CFG[step].accent : '#e2e8f0' }} />}
                </div>
              );
            })}
          </div>

          {/* Context */}
          <div className="space-y-3 rounded-2xl border p-4" style={{ borderColor: cfg.accent + '33', background: cfg.accent + '0d' }}>
            {[
              { Icon: StoreIcon, label: 'Store',       value: issue.store.name },
              { Icon: MapPin,    label: 'Area',        value: issue.store.areaName ?? '—' },
            ].map(({ Icon, label, value }) => (
              <div key={label} className="flex items-center gap-2.5">
                <Icon className="h-4 w-4 shrink-0" style={{ color: cfg.accent }} />
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{label}</p>
                  <p className="text-sm font-semibold text-slate-800">{value}</p>
                </div>
              </div>
            ))}
            <div className="flex items-center gap-2.5">
              <User className="h-4 w-4 shrink-0" style={{ color: cfg.accent }} />
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Reported by</p>
                <p className="text-sm font-semibold text-slate-800">{issue.reporter.name}</p>
                <p className="text-[11px] text-slate-400">NIK {issue.reporter.nik}</p>
              </div>
            </div>
          </div>

          {/* Description */}
          <div>
            <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">Description</p>
            <p className="whitespace-pre-wrap rounded-2xl border border-slate-100 bg-slate-50 p-4 text-sm leading-relaxed text-slate-700">
              {issue.description}
            </p>
          </div>

          {/* Photos */}
          {issue.attachmentUrls.length > 0 && (
            <div>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">Photos ({issue.attachmentUrls.length})</p>
              <div className="grid grid-cols-3 gap-2">
                {issue.attachmentUrls.map((url, i) => (
                  <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                    className="group relative block aspect-square overflow-hidden rounded-xl border border-slate-200 bg-slate-100 transition-all hover:border-indigo-300 hover:shadow-sm">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt={`Attachment ${i + 1}`} className="h-full w-full object-cover transition-transform group-hover:scale-105" />
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Berita Acara — read-only for Ops, uploaded by the reporter */}
          {issue.baAttachmentUrls.length > 0 && (
            <div>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Berita Acara ({issue.baAttachmentUrls.length})
              </p>
              <div className="grid grid-cols-3 gap-2">
                {issue.baAttachmentUrls.map((url, i) => {
                  const isImage = /\.(jpe?g|png|gif|webp|heic|heif)$/i.test(url);
                  const ext = url.split('.').pop()?.toUpperCase() ?? 'FILE';
                  return (
                    <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                      className="group relative block aspect-square overflow-hidden rounded-xl border border-violet-200 bg-slate-100 transition-all hover:border-violet-300 hover:shadow-sm">
                      {isImage ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={url} alt={`Berita Acara ${i + 1}`} className="h-full w-full object-cover transition-transform group-hover:scale-105" />
                      ) : (
                        <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-violet-50 px-1 text-center">
                          <FileText className="h-6 w-6 text-violet-500" />
                          <span className="text-[10px] font-bold text-violet-600">{ext}</span>
                        </div>
                      )}
                    </a>
                  );
                })}
              </div>
              {issue.baUploadedAt && (
                <p className="mt-1.5 text-[11px] text-slate-400">Uploaded {relativeTime(issue.baUploadedAt)}</p>
              )}
            </div>
          )}

          {issue.solvedAt && (
            <div className="flex items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-violet-500" />
              <p className="text-xs text-violet-700">Marked solved {relativeTime(issue.solvedAt)}</p>
            </div>
          )}

          {issue.reviewedAt && (
            <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
              <Eye className="h-4 w-4 shrink-0 text-emerald-500" />
              <p className="text-xs text-emerald-700">Reviewed {relativeTime(issue.reviewedAt)}</p>
            </div>
          )}

          <p className="text-center text-[11px] text-slate-300">Ref: {issue.id.padStart(6, '0')}</p>
        </div>

        {/* Footer action */}
        {cfg.next && (
          <div className="border-t border-slate-100 px-5 py-4">
            <button
              onClick={() => onAdvance(issue.id, cfg.next!)}
              disabled={updating}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl text-sm font-bold text-white transition-all active:scale-[0.99] disabled:opacity-60"
              style={{ background: STATUS_CFG[cfg.next].accent }}
            >
              {updating ? <Loader2 className="h-4 w-4 animate-spin" /> : <>{cfg.action}<ArrowRight className="h-4 w-4" /></>}
            </button>
          </div>
        )}
      </div>
      <style>{`@keyframes slideInRight{from{transform:translateX(100%)}to{transform:translateX(0)}}`}</style>
    </div>
  );
}

// ─── Issue row ────────────────────────────────────────────────────────────────

function IssueRow({ issue, onClick }: { issue: OpsIssue; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="group w-full rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition-all hover:border-indigo-200 hover:shadow-md"
    >
      <div className="mb-2 flex items-start justify-between gap-3">
        <p className="line-clamp-1 text-sm font-bold leading-snug text-slate-800">{issue.title}</p>
        <StatusBadge status={issue.status} />
      </div>
      <p className="mb-3 line-clamp-2 text-xs leading-relaxed text-slate-500">{issue.description}</p>
      <div className="flex items-center gap-3 text-[11px] text-slate-400">
        <span className="flex items-center gap-1"><StoreIcon className="h-3 w-3" />{issue.store.name}</span>
        <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{issue.store.areaName ?? 'Unknown'}</span>
        <span className="ml-auto flex items-center gap-1"><Clock className="h-3 w-3" />{relativeTime(issue.createdAt)}</span>
      </div>
    </button>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function OpsIssuesPage() {
  const { data: session, status: authStatus } = useSession();
  const router = useRouter();
  const role = (session?.user as any)?.role as string | undefined;
  const isOps = role === 'ops' || role === 'it';

  const [issuesList, setIssuesList] = useState<OpsIssue[]>([]);
  const [isHO,        setIsHO]       = useState(false);
  const [areaName,    setAreaName]   = useState<string | null>(null);
  const [loading,     setLoading]    = useState(true);
  const [refreshing,  setRefreshing] = useState(false);
  const [filter,      setFilter]     = useState<IssueStatus | 'all'>('all');
  const [storeFilter, setStoreFilter]= useState<string>('all');
  const [selected,    setSelected]   = useState<OpsIssue | null>(null);
  const [updating,    setUpdating]   = useState(false);

  useEffect(() => {
    if (authStatus === 'loading') return;
    if (!session) { router.replace('/login'); return; }
    if (!isOps)   router.replace('/');
  }, [authStatus, session, isOps, router]);

  const load = useCallback(async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    try {
      const res  = await fetch('/api/ops/issues', { cache: 'no-store' });
      const data = await res.json();
      setIssuesList(data.issues ?? []);
      setIsHO(!!data.isHO);
      setAreaName(data.area?.name ?? null);
    } catch {
      // silent
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, []);

  useEffect(() => { if (isOps) load(); }, [isOps, load]);

  // ── Derived: stores grouped by area, meta counts, visible list ──────────────
  const storesByArea = useMemo(() => {
    const m = new Map<string, { areaName: string; list: { id: string; name: string }[] }>();
    for (const i of issuesList) {
      const key = i.store.areaName ?? '—';
      if (!m.has(key)) m.set(key, { areaName: key, list: [] });
      const list = m.get(key)!.list;
      if (!list.some(s => s.id === i.store.id)) list.push({ id: i.store.id, name: i.store.name });
    }
    return [...m.values()].sort((a, b) => a.areaName.localeCompare(b.areaName));
  }, [issuesList]);

  const storeScoped = useMemo(
    () => storeFilter === 'all' ? issuesList : issuesList.filter(i => i.store.id === storeFilter),
    [issuesList, storeFilter],
  );

  const meta = useMemo(() => ({
    all:       storeScoped.length,
    reported:  storeScoped.filter(i => i.status === 'reported').length,
    in_review: storeScoped.filter(i => i.status === 'in_review').length,
    completed: storeScoped.filter(i => i.status === 'completed').length,
    solved:    storeScoped.filter(i => i.status === 'solved').length,
  }), [storeScoped]);

  const visible = useMemo(
    () => filter === 'all' ? storeScoped : storeScoped.filter(i => i.status === filter),
    [storeScoped, filter],
  );

  // ── Status advance ──────────────────────────────────────────────────────────
  async function handleAdvance(id: string, next: IssueStatus) {
    setUpdating(true);
    try {
      const res = await fetch(`/api/ops/issues/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) throw new Error();
      const { issue: updated } = await res.json();
      const patch = {
        status: updated.status as IssueStatus,
        reviewedAt: updated.reviewedAt ?? null,
        reviewedBy: updated.reviewedBy ?? null,
        updatedAt: updated.updatedAt,
      };
      setIssuesList(prev => prev.map(i => i.id === id ? { ...i, ...patch } : i));
      setSelected(prev => prev?.id === id ? { ...prev, ...patch } : prev);
    } catch {
      // silent
    } finally {
      setUpdating(false);
    }
  }

  const statCards = [
    { key: 'all'      as const, label: 'Total',     value: meta.all,       color: '#6366f1', Icon: AlertTriangle },
    { key: 'reported' as const, label: 'Reported',  value: meta.reported,  color: '#f59e0b', Icon: AlertCircle   },
    { key: 'in_review'as const, label: 'In Review', value: meta.in_review, color: '#3b82f6', Icon: Eye           },
    { key: 'solved'   as const, label: 'Solved',    value: meta.solved,    color: '#8b5cf6', Icon: CheckCircle2  },
    { key: 'completed'as const, label: 'Completed', value: meta.completed, color: '#10b981', Icon: CheckCircle2  },
  ];

  if (authStatus === 'loading' || !session) return (
    <div className="flex min-h-full items-center justify-center bg-slate-50"><Loader2 className="h-6 w-6 animate-spin text-indigo-400" /></div>
  );

  if (!isOps) return (
    <div className="flex min-h-full flex-col items-center justify-center gap-4 bg-slate-50 p-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50"><Shield className="h-8 w-8 text-red-500" /></div>
      <p className="text-base font-bold text-slate-800">Access Restricted</p>
      <p className="text-sm text-slate-500">Only OPS users can review issue reports.</p>
    </div>
  );

  return (
    <div className="min-h-full bg-slate-50">
      <OpsPageHeader
        scope={isHO ? 'OPS · Head Office' : 'OPS · Area Issues'}
        title="Issue Reports"
        subtitle={
          <span className="inline-flex items-center gap-1.5">
            {isHO ? (
              <>
                <Globe2 className="h-3.5 w-3.5" />
                All areas
              </>
            ) : (
              <>
                <MapPin className="h-3.5 w-3.5" />
                {areaName ?? 'Your area'}
              </>
            )}
            <span>·</span>
            <span>
              {issuesList.length} issue{issuesList.length !== 1 ? 's' : ''} routed to Ops
            </span>
          </span>
        }
        onRefresh={() => load(true)}
        refreshing={refreshing}
        contentClassName="w-full"
      />

      <div className="mx-auto max-w-7xl space-y-6 p-6 lg:p-8">

        {/* Store filter */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-end gap-4">
            <div className="min-w-[280px] flex-1">
              <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Store {isHO && <span className="text-amber-600">· all areas</span>}
              </label>
              <div className="relative">
                <StoreIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <select value={storeFilter} onChange={e => { setStoreFilter(e.target.value); setSelected(null); }}
                  className="h-11 w-full appearance-none rounded-xl border border-slate-200 bg-white pl-10 pr-10 text-sm font-semibold text-slate-800 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100">
                  <option value="all">All stores</option>
                  {storesByArea.length > 1
                    ? storesByArea.map(g => (
                        <optgroup key={g.areaName} label={g.areaName}>
                          {g.list.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </optgroup>
                      ))
                    : storesByArea[0]?.list.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              </div>
            </div>
            <p className="pb-3 text-xs tabular-nums text-slate-400">
              {visible.length} shown · click a card to filter by status
            </p>
          </div>
        </div>

        {/* Stat cards (clickable status filters) */}
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
          {statCards.map(({ key, label, value, color, Icon }) => {
            const active = filter === key;
            return (
              <button key={key} onClick={() => { setFilter(key); setSelected(null); }}
                className="flex items-center gap-3 rounded-2xl border bg-white px-4 py-4 text-left shadow-sm transition-all"
                style={{ borderColor: active ? color : '#e2e8f0', boxShadow: active ? `0 0 0 3px ${color}20` : undefined }}>
                <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: color + '15' }}>
                  <Icon className="h-5 w-5" style={{ color }} />
                </div>
                <div>
                  <p className="text-2xl font-bold tabular-nums" style={{ color }}>{value}</p>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
                </div>
              </button>
            );
          })}
        </div>

        {/* List */}
        {loading ? (
          <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-indigo-400" /></div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-slate-200 bg-white py-20 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-50"><AlertTriangle className="h-8 w-8 text-slate-300" /></div>
            <div>
              <p className="text-sm font-bold text-slate-700">No issues to show</p>
              <p className="mt-1 text-xs text-slate-400">
                {filter !== 'all' ? `No ${STATUS_CFG[filter as IssueStatus].label.toLowerCase()} issues in scope.` : 'Everything routed to Ops is clear.'}
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {visible.map(issue => (
              <IssueRow key={issue.id} issue={issue} onClick={() => setSelected(issue)} />
            ))}
          </div>
        )}
      </div>

      {selected && (
        <IssueDrawer
          issue={selected}
          updating={updating}
          onAdvance={handleAdvance}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}