'use client';

// app/employee/issues/page.tsx — mobile-first issue reporting for store staff.
//
// Employees now choose WHO an issue goes to (Ops, Finance, IT, …) when they
// report it. The destination list is fetched from /api/issues/assignable-roles
// so new departments appear automatically.

import { useState, useRef, useCallback, useEffect } from 'react';
import {
  AlertTriangle, Plus, X, ImagePlus, Loader2, ChevronRight, Clock,
  CheckCircle2, Eye, ArrowLeft, Users, Wallet, Monitor, Building2, Send,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  type Issue,
  type IssueStatus,
  type AssignableRole,
  STATUS_LABELS,
  STATUS_COLORS,
  fetchIssues,
  fetchAssignableRoles,
  createIssue,
  uploadIssueImages,
  formatRelativeTime,
} from '@/lib/issues';

// ─── Types ────────────────────────────────────────────────────────────────────

type View = 'list' | 'new' | 'detail';

// Icon per destination role code, with a safe fallback for roles added later.
const ROLE_ICON: Record<string, LucideIcon> = {
  ops:     Users,
  finance: Wallet,
  it:      Monitor,
};
const roleIcon = (code: string): LucideIcon => ROLE_ICON[code] ?? Building2;

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: IssueStatus }) {
  const c = STATUS_COLORS[status];
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold', c.bg, c.text)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', c.dot)} />
      {STATUS_LABELS[status]}
    </span>
  );
}

function AssigneeChip({ issue }: { issue: Issue }) {
  if (!issue.assignedTo) return null;
  const Icon = roleIcon(issue.assignedTo.code);
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
      <Icon className="h-3 w-3" />
      {issue.assignedTo.label}
    </span>
  );
}

function IssueCard({ issue, onClick }: { issue: Issue; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="group w-full rounded-2xl border border-border bg-card p-4 text-left transition-all hover:border-primary/40 hover:shadow-sm active:scale-[0.98]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">{issue.title}</p>
          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{issue.description}</p>
        </div>
        <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5" />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <StatusBadge status={issue.status} />
        <AssigneeChip issue={issue} />
        <span className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground">
          <Clock className="h-3 w-3" />{formatRelativeTime(issue.createdAt)}
        </span>
      </div>
    </button>
  );
}

function ImagePreview({ file, onRemove }: { file: File; onRemove: () => void }) {
  const [src, setSrc] = useState<string | null>(() => URL.createObjectURL(file));
  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  return (
    <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl border border-border bg-muted">
      {src
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={src} alt={file.name} className="h-full w-full object-cover" />
        : <div className="flex h-full w-full items-center justify-center"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>}
      <button type="button" onClick={onRemove}
        className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white transition-opacity hover:bg-black">
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

// ─── New Issue Form ───────────────────────────────────────────────────────────

function NewIssueForm({ onSuccess, onCancel }: { onSuccess: (issue: Issue) => void; onCancel: () => void }) {
  const [title, setTitle]             = useState('');
  const [description, setDescription] = useState('');
  const [images, setImages]           = useState<File[]>([]);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState<string | null>(null);

  const [roles, setRoles]             = useState<AssignableRole[]>([]);
  const [rolesLoading, setRolesLoading] = useState(true);
  const [assigneeId, setAssigneeId]   = useState<number | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    fetchAssignableRoles()
      .then(rs => { if (!alive) return; setRoles(rs); if (rs.length) setAssigneeId(rs[0].id); })
      .catch(() => { if (alive) setError('Could not load destinations. Pull to refresh.'); })
      .finally(() => { if (alive) setRolesLoading(false); });
    return () => { alive = false; };
  }, []);

  const addImages = useCallback((files: FileList | null) => {
    if (!files) return;
    const valid = Array.from(files).filter(f => f.type.startsWith('image/'));
    setImages(prev => [...prev, ...valid].slice(0, 5));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (title.trim().length < 3)         { setError('Title must be at least 3 characters.'); return; }
    if (description.trim().length < 10)  { setError('Please describe the issue in more detail (at least 10 characters).'); return; }
    if (!assigneeId)                     { setError('Please choose who to send this to.'); return; }

    setLoading(true);
    try {
      let attachmentUrls: string[] = [];
      if (images.length > 0) attachmentUrls = await uploadIssueImages(images, title.trim());

      const issue = await createIssue({
        title:            title.trim(),
        description:      description.trim(),
        assignedToRoleId: assigneeId,
        attachmentUrls,
      });
      onSuccess(issue);
    } catch (err: any) {
      setError(err?.message ?? 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-4">
        <button type="button" onClick={onCancel}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors hover:bg-muted/80">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div>
          <h2 className="font-semibold text-foreground">Report an Issue</h2>
          <p className="text-xs text-muted-foreground">Pick who should handle it</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 py-5">
        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}
          </div>
        )}

        {/* Destination picker */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Send to <span className="text-destructive">*</span>
          </label>
          {rolesLoading ? (
            <div className="grid grid-cols-2 gap-2">
              {[0, 1].map(i => <div key={i} className="h-16 animate-pulse rounded-2xl bg-muted" />)}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {roles.map(r => {
                const Icon = roleIcon(r.code);
                const active = assigneeId === r.id;
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setAssigneeId(r.id)}
                    className={cn(
                      'flex items-center gap-3 rounded-2xl border-2 px-3 py-3 text-left transition-all active:scale-[0.98]',
                      active ? 'border-primary bg-primary/5' : 'border-border bg-muted/40 hover:border-primary/30',
                    )}
                  >
                    <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
                      active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className={cn('truncate text-sm font-bold', active ? 'text-primary' : 'text-foreground')}>{r.label}</p>
                      {r.description && <p className="truncate text-[10px] text-muted-foreground">{r.description}</p>}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Title */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Issue Title <span className="text-destructive">*</span>
          </label>
          <input
            value={title} onChange={e => setTitle(e.target.value)}
            placeholder="e.g. Broken AC unit in back room" maxLength={120}
            className="w-full rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
          />
          <span className="self-end text-[11px] text-muted-foreground">{title.length}/120</span>
        </div>

        {/* Description */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Description <span className="text-destructive">*</span>
          </label>
          <textarea
            value={description} onChange={e => setDescription(e.target.value)}
            placeholder="Describe the issue clearly — what happened, when, and any relevant context..."
            rows={5} maxLength={2000}
            className="w-full resize-none rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
          />
          <span className="self-end text-[11px] text-muted-foreground">{description.length}/2000</span>
        </div>

        {/* Images */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Photos <span className="font-normal normal-case tracking-normal text-muted-foreground/50">(optional, up to 5)</span>
          </label>
          <div className="flex flex-wrap gap-2">
            {images.map((file, i) => (
              <ImagePreview key={`${file.name}-${i}`} file={file} onRemove={() => setImages(prev => prev.filter((_, idx) => idx !== i))} />
            ))}
            {images.length < 5 && (
              <button type="button" onClick={() => fileRef.current?.click()}
                className="flex h-20 w-20 shrink-0 flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-border text-muted-foreground/60 transition-colors hover:border-primary/40 hover:text-primary/60">
                <ImagePlus className="h-5 w-5" /><span className="text-[10px]">Add</span>
              </button>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={e => addImages(e.target.files)} />
        </div>

        <div className="flex-1" />

        <button type="submit" disabled={loading || rolesLoading}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-3.5 font-semibold text-primary-foreground transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-60">
          {loading ? <><Loader2 className="h-4 w-4 animate-spin" />Submitting…</> : <><Send className="h-4 w-4" />Submit Report</>}
        </button>
      </form>
    </div>
  );
}

// ─── Issue Detail ─────────────────────────────────────────────────────────────

function IssueDetail({ issue, onBack }: { issue: Issue; onBack: () => void }) {
  const steps: IssueStatus[] = ['reported', 'in_review', 'resolved'];
  const currentIdx = steps.indexOf(issue.status);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-border px-4 py-4">
        <button type="button" onClick={onBack} className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-semibold text-foreground">{issue.title}</h2>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 py-5">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={issue.status} />
          <AssigneeChip issue={issue} />
          <span className="text-xs text-muted-foreground">Reported {formatRelativeTime(issue.createdAt)}</span>
        </div>

        {/* Status timeline */}
        <div className="flex items-center gap-0">
          {steps.map((s, i, arr) => {
            const done = i <= currentIdx;
            const isLast = i === arr.length - 1;
            return (
              <div key={s} className="flex flex-1 items-center">
                <div className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold transition-colors',
                  done ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-muted-foreground')}>
                  {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : i + 1}
                </div>
                <span className={cn('ml-1 mr-1 text-[10px] font-semibold', done ? 'text-primary' : 'text-muted-foreground')}>{STATUS_LABELS[s]}</span>
                {!isLast && <div className={cn('mx-1 h-0.5 flex-1', i < currentIdx ? 'bg-primary' : 'bg-border')} />}
              </div>
            );
          })}
        </div>

        {/* Destination */}
        {issue.assignedTo && (
          <div className="flex items-center gap-3 rounded-2xl border border-border bg-muted/30 p-4">
            {(() => { const Icon = roleIcon(issue.assignedTo.code); return <Icon className="h-5 w-5 shrink-0 text-primary" />; })()}
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Sent to</p>
              <p className="text-sm font-semibold text-foreground">{issue.assignedTo.label}</p>
            </div>
          </div>
        )}

        {/* Description */}
        <div className="rounded-2xl border border-border bg-muted/30 p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">Description</p>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{issue.description}</p>
        </div>

        {/* Photos */}
        {issue.attachmentUrls.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">Photos ({issue.attachmentUrls.length})</p>
            <div className="flex flex-wrap gap-2">
              {issue.attachmentUrls.map((url, i) => (
                <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                  className="block h-24 w-24 shrink-0 overflow-hidden rounded-xl border border-border bg-muted transition-opacity hover:opacity-80">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt={`Attachment ${i + 1}`} className="h-full w-full object-cover" />
                </a>
              ))}
            </div>
          </div>
        )}

        {issue.reviewedAt && (
          <div className="flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
            <Eye className="h-4 w-4 shrink-0 text-emerald-500" />
            <p className="text-xs text-emerald-600 dark:text-emerald-400">Reviewed {formatRelativeTime(issue.reviewedAt)}</p>
          </div>
        )}

        <p className="text-center text-[11px] text-muted-foreground/50">Ref: {issue.id.padStart(6, '0')}</p>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function IssuesPage() {
  const [view, setView]               = useState<View>('list');
  const [issuesList, setIssuesList]   = useState<Issue[]>([]);
  const [selected, setSelected]       = useState<Issue | null>(null);
  const [loading, setLoading]         = useState(true);
  const [filter, setFilter]           = useState<IssueStatus | 'all'>('all');
  const [showSuccess, setShowSuccess] = useState(false);

  const loadIssues = useCallback(async () => {
    setLoading(true);
    try {
      setIssuesList(await fetchIssues(filter === 'all' ? undefined : filter));
    } catch {
      // silent — empty state shows
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { loadIssues(); }, [loadIssues]);

  const handleSuccess = (issue: Issue) => {
    setIssuesList(prev => [issue, ...prev]);
    setShowSuccess(true);
    setView('list');
    setTimeout(() => setShowSuccess(false), 4000);
  };

  const FILTERS: { value: IssueStatus | 'all'; label: string }[] = [
    { value: 'all',       label: 'All'       },
    { value: 'reported',  label: 'Reported'  },
    { value: 'in_review', label: 'In Review' },
    { value: 'resolved',  label: 'Resolved'  },
  ];

  if (view === 'new') {
    return (
      <div className="flex h-full flex-col bg-background pb-16">
        <NewIssueForm onSuccess={handleSuccess} onCancel={() => setView('list')} />
      </div>
    );
  }

  if (view === 'detail' && selected) {
    return (
      <div className="flex h-full flex-col bg-background pb-16">
        <IssueDetail issue={selected} onBack={() => setView('list')} />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-background pb-16">
      {/* Header */}
      <div className="px-4 pb-3 pt-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground">Issue Reports</h1>
            <p className="mt-0.5 text-xs text-muted-foreground">Report problems to the right team</p>
          </div>
          <button onClick={() => setView('new')}
            className="flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground shadow-sm transition-all hover:opacity-90 active:scale-95">
            <Plus className="h-3.5 w-3.5" />New Report
          </button>
        </div>
      </div>

      {showSuccess && (
        <div className="mx-4 mb-2 flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
          <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">Issue reported! The team has been notified.</p>
        </div>
      )}

      {/* Filter tabs */}
      <div className="scrollbar-none flex gap-2 overflow-x-auto px-4 pb-3">
        {FILTERS.map(f => (
          <button key={f.value} onClick={() => setFilter(f.value)}
            className={cn('shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors',
              filter === f.value ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80')}>
            {f.label}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto px-4 py-1">
        {loading ? (
          <div className="flex flex-1 items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : issuesList.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted"><AlertTriangle className="h-6 w-6 text-muted-foreground/50" /></div>
            <div>
              <p className="text-sm font-semibold text-foreground">No issues found</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {filter === 'all' ? 'Tap "New Report" to report a problem.' : `No issues with status "${STATUS_LABELS[filter as IssueStatus]}".`}
              </p>
            </div>
          </div>
        ) : (
          issuesList.map(issue => (
            <IssueCard key={issue.id} issue={issue} onClick={() => { setSelected(issue); setView('detail'); }} />
          ))
        )}
      </div>
    </div>
  );
}