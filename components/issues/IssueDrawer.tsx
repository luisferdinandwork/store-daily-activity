'use client';
// components/issues/IssueDrawer.tsx
//
// The follow-up panel of the Ops and Finance issue inboxes: a right-side drawer
// on desktop, a bottom sheet on phones. Shows the report (who, where, what,
// photos + Berita Acara) and the single next step the panel may take.

import { ArrowRight, CheckCircle2, Eye, Loader2, X } from 'lucide-react';

import { cn } from '@/lib/utils';
import { IssueAttachments } from '@/components/shared/IssueAttachments';
import {
  INBOX_STATUSES,
  fmtIssueDate,
  inboxStatusLabel,
  issueRef,
  relativeTime,
  type InboxIssue,
  type InboxStatus,
} from '@/lib/issue-inbox';
import { STATUS_CFG, StatusBadge, THEME, type InboxTheme } from './shared';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold text-slate-800">{children}</dd>
    </div>
  );
}

export function IssueDrawer({
  issue,
  theme,
  updating,
  onClose,
  onAdvance,
}: {
  issue: InboxIssue;
  theme: InboxTheme;
  updating: boolean;
  onClose: () => void;
  onAdvance: (id: string, next: InboxStatus) => void;
}) {
  const cfg = STATUS_CFG[issue.status];
  const currentIdx = INBOX_STATUSES.indexOf(issue.status);

  return (
    <div className="fixed inset-0 z-50 flex max-md:flex-col max-md:justify-end" onClick={onClose}>
      <div className="bg-slate-900/50 backdrop-blur-sm max-md:absolute max-md:inset-0 md:flex-1" />
      <div
        role="dialog"
        aria-label={issue.title}
        className="relative flex w-[440px] max-w-full flex-col overflow-hidden bg-white shadow-2xl max-md:max-h-[92dvh] max-md:w-full max-md:rounded-t-3xl max-md:[animation:slideUpSheet_0.3s_cubic-bezier(0.2,0.8,0.2,1)] md:[animation:slideInRight_0.25s_ease-out]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Grabber (phones) */}
        <div className="flex justify-center pt-2.5 md:hidden">
          <span className="h-1.5 w-10 rounded-full bg-slate-200" />
        </div>

        {/* Header */}
        <div className="border-b border-slate-100 px-5 py-4 md:px-6 md:py-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[11px] font-semibold text-slate-400">#{issueRef(issue.id)}</span>
                <StatusBadge status={issue.status} />
              </div>
              <p className="mt-1.5 text-lg font-bold leading-snug text-slate-900">{issue.title}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-400 hover:bg-slate-200"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4 md:px-6">
          {/* Progress */}
          <div className="flex items-center gap-1">
            {INBOX_STATUSES.map((step, i) => {
              const done = i <= currentIdx;
              const isLast = i === INBOX_STATUSES.length - 1;
              return (
                <div key={step} className="flex flex-1 items-center gap-1">
                  <div
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-[10px] font-bold transition-colors"
                    style={{
                      borderColor: done ? STATUS_CFG[step].accent : '#e2e8f0',
                      background: done ? STATUS_CFG[step].accent : 'white',
                      color: done ? 'white' : '#94a3b8',
                    }}
                  >
                    {done ? <CheckCircle2 className="h-3 w-3" /> : i + 1}
                  </div>
                  <span
                    className={cn('whitespace-nowrap text-[10px] font-bold', i !== currentIdx && 'max-sm:hidden')}
                    style={{ color: done ? STATUS_CFG[step].accent : '#94a3b8' }}
                  >
                    {inboxStatusLabel(step)}
                  </span>
                  {!isLast && (
                    <div className="mx-1 h-px flex-1" style={{ background: i < currentIdx ? STATUS_CFG[step].accent : '#e2e8f0' }} />
                  )}
                </div>
              );
            })}
          </div>

          {/* Details */}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border border-slate-200 bg-slate-50/60 p-4">
            <Field label="Store">{issue.store.name}</Field>
            <Field label="Area">{issue.store.areaName ?? '—'}</Field>
            <Field label="Reported by">
              {issue.reporter.name}
              <span className="block text-[11px] font-normal text-slate-400">NIK {issue.reporter.nik}</span>
            </Field>
            <Field label="Reported">
              {fmtIssueDate(issue.createdAt)}
              <span className="block text-[11px] font-normal text-slate-400">{relativeTime(issue.createdAt)}</span>
            </Field>
          </dl>

          {/* Description */}
          <div>
            <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">Description</p>
            <p className="whitespace-pre-wrap rounded-lg border border-slate-200 p-4 text-sm leading-relaxed text-slate-700">
              {issue.description}
            </p>
          </div>

          {/* Photos + Berita Acara — images open in a viewer, not a new tab */}
          <IssueAttachments
            title={issue.title}
            attachmentUrls={issue.attachmentUrls}
            baAttachmentUrls={issue.baAttachmentUrls}
            baUploadedLabel={issue.baUploadedAt ? `Uploaded ${relativeTime(issue.baUploadedAt)}` : null}
            hoverClass={THEME[theme].drawerHover}
          />

          {issue.solvedAt && (
            <div className="flex items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-4 py-3">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-violet-500" />
              <p className="text-xs text-violet-700">Marked solved {relativeTime(issue.solvedAt)}</p>
            </div>
          )}

          {issue.reviewedAt && (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
              <Eye className="h-4 w-4 shrink-0 text-emerald-500" />
              <p className="text-xs text-emerald-700">Reviewed {relativeTime(issue.reviewedAt)}</p>
            </div>
          )}
        </div>

        {/* Footer action */}
        {cfg.next && (
          <div className="border-t border-slate-100 px-5 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4 md:px-6 md:pb-4">
            <button
              type="button"
              onClick={() => onAdvance(issue.id, cfg.next!)}
              disabled={updating}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl text-sm font-bold text-white transition-all active:scale-[0.99] disabled:opacity-60"
              style={{ background: STATUS_CFG[cfg.next].accent }}
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
      <style>{`@keyframes slideInRight{from{transform:translateX(100%)}to{transform:translateX(0)}}@keyframes slideUpSheet{from{transform:translateY(100%)}to{transform:translateY(0)}}`}</style>
    </div>
  );
}
