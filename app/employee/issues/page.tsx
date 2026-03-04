'use client';

// app/employee/issues/page.tsx

import { useState, useRef, useCallback, useEffect } from 'react';
import { AlertTriangle, Plus, X, ImagePlus, Loader2, ChevronRight, Clock, CheckCircle2, Eye, ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  type Issue,
  type IssueStatus,
  STATUS_LABELS,
  STATUS_COLORS,
  fetchIssues,
  createIssue,
  uploadIssueImages,
  formatRelativeTime,
} from '@/lib/issues';

// ─── Types ────────────────────────────────────────────────────────────────────

type View = 'list' | 'new' | 'detail';

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

function IssueCard({ issue, onClick }: { issue: Issue; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="group w-full rounded-2xl border border-border bg-card p-4 text-left transition-all hover:border-primary/40 hover:shadow-sm active:scale-[0.98]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="truncate font-semibold text-foreground text-sm">{issue.title}</p>
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground leading-relaxed">
            {issue.description}
          </p>
        </div>
        <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5" />
      </div>
      <div className="mt-3 flex items-center justify-between">
        <StatusBadge status={issue.status} />
        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <Clock className="h-3 w-3" />
          {formatRelativeTime(issue.createdAt)}
        </span>
      </div>
    </button>
  );
}

function ImagePreview({
  file,
  onRemove,
}: {
  file: File;
  onRemove: () => void;
}) {
  // Create the blob URL synchronously in the state initializer so the very
  // first render already has a real URL — never an empty string.
  const [src, setSrc] = useState<string | null>(() => URL.createObjectURL(file));

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSrc(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [file]);

  return (
    <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl border border-border bg-muted">
      {src && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={file.name} className="h-full w-full object-cover" />
      )}
      {!src && (
        <div className="flex h-full w-full items-center justify-center">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      )}
      <button
        type="button"
        onClick={onRemove}
        className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white transition-opacity hover:bg-black"
      >
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
  const fileRef = useRef<HTMLInputElement>(null);

  const addImages = useCallback((files: FileList | null) => {
    if (!files) return;
    const valid = Array.from(files).filter(f => f.type.startsWith('image/'));
    setImages(prev => [...prev, ...valid].slice(0, 5)); // max 5
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!title.trim() || title.trim().length < 3) {
      setError('Title must be at least 3 characters.');
      return;
    }
    if (!description.trim() || description.trim().length < 10) {
      setError('Please describe the issue in more detail (at least 10 characters).');
      return;
    }

    setLoading(true);
    try {
      let attachmentUrls: string[] = [];
      if (images.length > 0) {
        // Pass title so the server can name the file <title>_<store>_<date>.<ext>.
        // storeName is fetched from the session on the server side; pass what
        // we have client-side (title is enough for a meaningful filename).
        attachmentUrls = await uploadIssueImages(images, title.trim());
      }

      const issue = await createIssue({
        title:       title.trim(),
        description: description.trim(),
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
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-4">
        <button
          type="button"
          onClick={onCancel}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors hover:bg-muted/80"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div>
          <h2 className="font-semibold text-foreground">Report an Issue</h2>
          <p className="text-xs text-muted-foreground">Ops will be notified</p>
        </div>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 py-5">

        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {/* Title */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Issue Title <span className="text-destructive">*</span>
          </label>
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="e.g. Broken AC unit in back room"
            maxLength={120}
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
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Describe the issue clearly — what happened, when, and any relevant context..."
            rows={5}
            maxLength={2000}
            className="w-full resize-none rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
          />
          <span className="self-end text-[11px] text-muted-foreground">{description.length}/2000</span>
        </div>

        {/* Images */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Photos <span className="text-muted-foreground/50 normal-case font-normal tracking-normal">(optional, up to 5)</span>
          </label>

          <div className="flex flex-wrap gap-2">
            {images.map((file, i) => (
              <ImagePreview
                key={`${file.name}-${i}`}
                file={file}
                onRemove={() => setImages(prev => prev.filter((_, idx) => idx !== i))}
              />
            ))}

            {images.length < 5 && (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex h-20 w-20 shrink-0 flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-border text-muted-foreground/60 transition-colors hover:border-primary/40 hover:text-primary/60"
              >
                <ImagePlus className="h-5 w-5" />
                <span className="text-[10px]">Add</span>
              </button>
            )}
          </div>

          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={e => addImages(e.target.files)}
          />
        </div>

        {/* Spacer to push button above nav */}
        <div className="flex-1" />

        {/* Submit */}
        <button
          type="submit"
          disabled={loading}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-3.5 font-semibold text-primary-foreground transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-60"
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Submitting…
            </>
          ) : (
            <>
              <AlertTriangle className="h-4 w-4" />
              Submit Report
            </>
          )}
        </button>
      </form>
    </div>
  );
}

// ─── Issue Detail View ────────────────────────────────────────────────────────

function IssueDetail({ issue, onBack }: { issue: Issue; onBack: () => void }) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 border-b border-border px-4 py-4">
        <button
          type="button"
          onClick={onBack}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-muted-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="truncate font-semibold text-foreground">{issue.title}</h2>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 py-5">
        {/* Status timeline */}
        <div className="flex items-center gap-2">
          <StatusBadge status={issue.status} />
          <span className="text-xs text-muted-foreground">
            Reported {formatRelativeTime(issue.createdAt)}
          </span>
        </div>

        {/* Status timeline visual */}
        <div className="flex items-center gap-0">
          {(['reported', 'in_review', 'resolved'] as IssueStatus[]).map((s, i, arr) => {
            const steps = ['reported', 'in_review', 'resolved'] as IssueStatus[];
            const currentIdx = steps.indexOf(issue.status);
            const stepIdx = steps.indexOf(s);
            const isCompleted = stepIdx <= currentIdx;
            const isLast = i === arr.length - 1;

            return (
              <div key={s} className="flex flex-1 items-center">
                <div className={cn(
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold transition-colors',
                  isCompleted
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-card text-muted-foreground',
                )}>
                  {isCompleted ? <CheckCircle2 className="h-3.5 w-3.5" /> : i + 1}
                </div>
                <div className="ml-1 mr-1 flex flex-col">
                  <span className={cn('text-[10px] font-semibold', isCompleted ? 'text-primary' : 'text-muted-foreground')}>
                    {STATUS_LABELS[s]}
                  </span>
                </div>
                {!isLast && (
                  <div className={cn('flex-1 h-0.5 mx-1', isCompleted && stepIdx < currentIdx ? 'bg-primary' : 'bg-border')} />
                )}
              </div>
            );
          })}
        </div>

        {/* Description */}
        <div className="rounded-2xl border border-border bg-muted/30 p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">Description</p>
          <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{issue.description}</p>
        </div>

        {/* Attachment images */}
        {issue.attachmentUrls && issue.attachmentUrls.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Photos ({issue.attachmentUrls.length})
            </p>
            <div className="flex flex-wrap gap-2">
              {issue.attachmentUrls.map((url, i) => (
                <a
                  key={i}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block h-24 w-24 shrink-0 overflow-hidden rounded-xl border border-border bg-muted transition-opacity hover:opacity-80"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={url}
                    alt={`Attachment ${i + 1}`}
                    className="h-full w-full object-cover"
                  />
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Reviewed by (if applicable) */}
        {issue.reviewedAt && (
          <div className="flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
            <Eye className="h-4 w-4 text-emerald-500 shrink-0" />
            <p className="text-xs text-emerald-600 dark:text-emerald-400">
              Reviewed {formatRelativeTime(issue.reviewedAt)}
            </p>
          </div>
        )}

        {/* ID for reference */}
        <p className="text-center text-[11px] text-muted-foreground/50">
          Ref: {issue.id.slice(0, 8).toUpperCase()}
        </p>
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
      const data = await fetchIssues(filter === 'all' ? undefined : filter);
      setIssuesList(data);
    } catch {
      // silently fail — user sees empty state
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

  // ── Render ──

  if (view === 'new') {
    return (
      <div className="flex h-full flex-col bg-background pb-16">
        <NewIssueForm
          onSuccess={handleSuccess}
          onCancel={() => setView('list')}
        />
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

  // ── List view ──

  return (
    <div className="flex h-full flex-col bg-background pb-16">

      {/* Header */}
      <div className="px-4 pb-3 pt-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground">Issue Reports</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Report problems to your Ops team</p>
          </div>
          <button
            onClick={() => setView('new')}
            className="flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground shadow-sm transition-all hover:opacity-90 active:scale-95"
          >
            <Plus className="h-3.5 w-3.5" />
            New Report
          </button>
        </div>
      </div>

      {/* Success toast */}
      {showSuccess && (
        <div className="mx-4 mb-2 flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
          <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
          <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
            Issue reported! Ops has been notified.
          </p>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-2 overflow-x-auto px-4 pb-3 scrollbar-none">
        {FILTERS.map(f => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={cn(
              'shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors',
              filter === f.value
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto px-4 py-1">
        {loading ? (
          <div className="flex flex-1 items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : issuesList.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
              <AlertTriangle className="h-6 w-6 text-muted-foreground/50" />
            </div>
            <div>
              <p className="font-semibold text-foreground text-sm">No issues found</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {filter === 'all' ? 'Tap "New Report" to report a problem.' : `No issues with status "${STATUS_LABELS[filter as IssueStatus]}".`}
              </p>
            </div>
          </div>
        ) : (
          issuesList.map(issue => (
            <IssueCard
              key={issue.id}
              issue={issue}
              onClick={() => { setSelected(issue); setView('detail'); }}
            />
          ))
        )}
      </div>
    </div>
  );
}