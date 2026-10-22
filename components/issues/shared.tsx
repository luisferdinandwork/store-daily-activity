'use client';
// components/issues/shared.tsx
//
// Look + words shared by the Ops and Finance issue inboxes: the status colours,
// the badge, and the per-panel accent (Ops = indigo, Finance = emerald). Status
// names come from STATUS_LABELS (lib/issues.ts) — one name per thing.

import { AlertCircle, CheckCircle2, Eye, type LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import { inboxStatusLabel, type InboxStatus } from '@/lib/issue-inbox';

// ─── Status ──────────────────────────────────────────────────────────────────

export const STATUS_CFG: Record<
  InboxStatus,
  {
    accent: string;
    Icon: LucideIcon;
    /** The status the panel can move it to, and the button saying so. */
    next: InboxStatus | null;
    action: string;
    /** One quiet line for what is waiting on the panel (shown under the badge). */
    waiting: string | null;
  }
> = {
  reported: { accent: '#f59e0b', Icon: AlertCircle, next: 'in_review', action: 'Start Review', waiting: 'Awaiting review' },
  in_review: { accent: '#3b82f6', Icon: Eye, next: null, action: '', waiting: null },
  solved: { accent: '#8b5cf6', Icon: CheckCircle2, next: 'completed', action: 'Mark Complete', waiting: 'Confirm to complete' },
  completed: { accent: '#10b981', Icon: CheckCircle2, next: null, action: '', waiting: null },
};

export function StatusBadge({ status, className }: { status: InboxStatus; className?: string }) {
  const c = STATUS_CFG[status];
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-bold', className)}
      style={{ background: c.accent + '18', color: c.accent }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: c.accent }} />
      {inboxStatusLabel(status)}
    </span>
  );
}

// ─── Panel accent ────────────────────────────────────────────────────────────
// Tailwind only sees whole class names, so each accent spells its classes out.

export type InboxTheme = 'indigo' | 'emerald';

export const THEME = {
  indigo: {
    focus: 'focus:border-indigo-400 focus:ring-indigo-100',
    selectOn: 'border-indigo-300 bg-indigo-50 text-indigo-800',
    chipOn: 'bg-indigo-600 text-white',
    rowHover: 'hover:bg-indigo-50/40',
    rowOn: 'bg-indigo-50/60',
    link: 'text-indigo-600 hover:text-indigo-800',
    spinner: 'text-indigo-400',
    thSortOn: 'text-indigo-700',
    drawerHover: 'hover:border-indigo-300',
  },
  emerald: {
    focus: 'focus:border-emerald-500 focus:ring-emerald-100',
    selectOn: 'border-emerald-300 bg-emerald-50 text-emerald-800',
    chipOn: 'bg-emerald-600 text-white',
    rowHover: 'hover:bg-emerald-50/40',
    rowOn: 'bg-emerald-50/60',
    link: 'text-emerald-600 hover:text-emerald-800',
    spinner: 'text-emerald-400',
    thSortOn: 'text-emerald-700',
    drawerHover: 'hover:border-emerald-300',
  },
} as const;
