'use client';
// components/ops/dashboard/widgets.tsx
//
// The pieces the Ops Dashboard is made of, shared by its desktop layout (app/ops/page.tsx) and
// its phone layout (components/ops/mobile/DashboardMobile.tsx): a titled card, the "FF001 - Store
// name" line every list uses, the how-long-it-has-waited chip, and the Today rate card with its
// stores-needing-attention list.
//
// Colours are never picked here: status colours come from lib/status-theme.ts (TONES), so the
// dashboard retunes with the rest of the panel.

import Link from 'next/link';
import type { ElementType, ReactNode } from 'react';
import { ArrowRight, CheckCircle2, MapPin } from 'lucide-react';

import { cn } from '@/lib/utils';
import { RateBar } from '@/components/status/TaskStatus';
import { RATE_WORD, rateBand } from '@/lib/ops-dashboard';
import { waitingLabel, waitingMinutes, waitingTone, type QueueStore } from '@/lib/ops-dashboard-queues';
import { formatStamp } from '@/lib/transfer-order-metrics';
import { TONES, type Tone } from '@/lib/status-theme';

// ─── Headings + links ────────────────────────────────────────────────────────

export function SectionHeading({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">{children}</p>
      {right && <div className="text-[11px] text-slate-400">{right}</div>}
    </div>
  );
}

export function ViewLink({ href, children = 'View all' }: { href: string; children?: ReactNode }) {
  return (
    <Link
      href={href}
      className="group flex shrink-0 items-center gap-1 text-xs font-medium text-slate-500 transition-colors hover:text-indigo-600"
    >
      {children}
      <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

// ─── Card ────────────────────────────────────────────────────────────────────

/** Icon tile — the one shape every card header uses. */
export function IconTile({ icon: Icon, tone = 'active' }: { icon: ElementType; tone?: Tone }) {
  return (
    <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', TONES[tone].soft)}>
      <Icon className="h-4.5 w-4.5" />
    </span>
  );
}

export function CountChip({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold tabular-nums',
        TONES[tone].chip,
      )}
    >
      {children}
    </span>
  );
}

/**
 * A dashboard card: icon tile, title, how many are waiting, and a link to the page that
 * handles them. `children` is the body (usually a `QueueList`).
 */
export function DashCard({
  icon,
  tone = 'active',
  title,
  subtitle,
  count,
  href,
  linkLabel,
  children,
  className,
}: {
  icon: ElementType;
  tone?: Tone;
  title: string;
  subtitle?: string;
  /** How many are waiting in all (shown as a chip while above 0). */
  count?: number;
  href?: string;
  linkLabel?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm', className)}>
      <div className="flex items-center gap-3 px-4 pb-3 pt-4 sm:px-5 sm:pt-5">
        <IconTile icon={icon} tone={tone} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-slate-900">{title}</h3>
          {subtitle && <p className="truncate text-xs text-slate-500">{subtitle}</p>}
        </div>
        {count != null && count > 0 && <CountChip tone={tone}>{count}</CountChip>}
        {href && <ViewLink href={href}>{linkLabel}</ViewLink>}
      </div>
      <div className="flex-1 border-t border-slate-100">{children}</div>
    </section>
  );
}

// ─── List atoms ──────────────────────────────────────────────────────────────

/** "FF001 - Fisik Football Daan Mogot" — the code stands out, the name follows. */
export function StoreName({ storeNo, name, className }: { storeNo: string; name: string; className?: string }) {
  return (
    <p className={cn('truncate text-sm', className)}>
      {storeNo && (
        <>
          <span className="font-semibold text-slate-900">{storeNo}</span>
          <span className="text-slate-300"> - </span>
        </>
      )}
      <span className="font-medium text-slate-700">{name}</span>
    </p>
  );
}

/** "DKI - BALI · Ops Indriawan" — the area and the Ops Area user(s) who look after the store. */
export function AreaLine({ store, className }: { store: QueueStore; className?: string }) {
  return (
    <p className={cn('flex items-center gap-1.5 text-[11px] text-slate-500', className)}>
      <MapPin className="h-3 w-3 shrink-0 text-slate-400" />
      <span className="truncate">
        {store.areaName}
        <span className="text-slate-300"> · </span>
        {store.opsNames.length ? (
          <>Ops {store.opsNames.join(', ')}</>
        ) : (
          <span className="italic text-slate-400">Ops Area belum ditentukan</span>
        )}
      </span>
    </p>
  );
}

/** How long it has waited — calm under a day, warning from a day, danger from three. */
export function WaitChip({ since }: { since: string | null }) {
  const minutes = waitingMinutes(since);
  return (
    <span
      title={since ? `Menunggu sejak ${formatStamp(since)}` : 'Waktu mulai tidak tercatat'}
      className={cn(
        'inline-flex shrink-0 items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold tabular-nums',
        TONES[waitingTone(minutes)].chip,
      )}
    >
      {waitingLabel(minutes)}
    </span>
  );
}

/** One tappable row of a list. */
export function QueueRow({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <li className={className}>
      <Link
        href={href}
        className="block px-4 py-3 transition-colors hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none sm:px-5"
      >
        {children}
      </Link>
    </li>
  );
}

export function QueueEmpty({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1.5 px-6 py-8 text-center">
      <CheckCircle2 className={cn('h-5 w-5', TONES.success.text)} />
      <p className="text-sm text-slate-500">{children}</p>
    </div>
  );
}

export function QueueSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3 px-4 py-4 sm:px-5" aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="h-3.5 flex-1 animate-pulse rounded bg-slate-100" />
          <div className="h-5 w-12 animate-pulse rounded-full bg-slate-100" />
        </div>
      ))}
    </div>
  );
}

/** "+3 more" under a list that was cut short. */
export function MoreLink({ href, count, noun }: { href: string; count: number; noun: string }) {
  if (count <= 0) return null;
  return (
    <Link
      href={href}
      className="group flex items-center justify-between border-t border-slate-100 px-4 py-2.5 text-xs text-slate-500 transition-colors hover:bg-slate-50 hover:text-indigo-600 sm:px-5"
    >
      <span>
        +{count} more {noun}
      </span>
      <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

// ─── Today rate card ─────────────────────────────────────────────────────────

export interface AttentionRow {
  key: string;
  storeNo: string;
  name: string;
  /** null = no shifts today, so nothing to rate. */
  rate: number | null;
  /** Muted figure beside the rate, e.g. "3/8 task". */
  detail?: string;
}

/**
 * Today's rate (attendance or task completion) as one big number, and below it the stores
 * that need the most attention — worst first, in the "FF001 - Store name" style.
 */
export function RateCard({
  icon,
  label,
  subtitle,
  rate,
  caption,
  rows,
  total,
  href,
  emptyText,
  noun = 'stores',
  loading,
}: {
  icon: ElementType;
  label: string;
  subtitle: string;
  rate: number;
  caption: ReactNode;
  rows: AttentionRow[];
  /** How many stores need attention in all (rows shows the worst few). */
  total: number;
  href: string;
  emptyText: string;
  noun?: string;
  loading: boolean;
}) {
  const band = rateBand(rate);

  return (
    <section className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="px-4 pb-4 pt-4 sm:px-5 sm:pt-5">
        <div className="flex items-center gap-3">
          <IconTile icon={icon} />
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-semibold text-slate-900">{label}</h3>
            <p className="truncate text-xs text-slate-500">{subtitle}</p>
          </div>
          <ViewLink href={href} />
        </div>

        {loading ? (
          <div className="mt-4 space-y-3" aria-hidden>
            <div className="h-10 w-28 animate-pulse rounded-lg bg-slate-100" />
            <div className="h-1.5 w-full animate-pulse rounded-full bg-slate-100" />
            <div className="h-3 w-44 animate-pulse rounded bg-slate-100" />
          </div>
        ) : (
          <>
            <div className="mt-4 flex items-end gap-3">
              <p className="text-[40px] font-semibold leading-none tracking-tight tabular-nums text-slate-900">{rate}%</p>
              <CountChip tone={band}>{RATE_WORD[band]}</CountChip>
            </div>
            <RateBar rate={rate} className="mt-3" />
            <p className="mt-2 text-xs text-slate-500">{caption}</p>
          </>
        )}
      </div>

      <div className="flex-1 border-t border-slate-100">
        <div className="flex items-center justify-between px-4 pb-1 pt-3 sm:px-5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Needs attention</p>
          {!loading && total > 0 && (
            <span className="text-[11px] tabular-nums text-slate-400">
              {total} {total === 1 ? noun.replace(/s$/, '') : noun}
            </span>
          )}
        </div>

        {loading ? (
          <QueueSkeleton />
        ) : rows.length === 0 ? (
          <QueueEmpty>{emptyText}</QueueEmpty>
        ) : (
          <ul className="pb-1.5">
            {rows.map((row) => {
              const rowBand = row.rate === null ? null : rateBand(row.rate);
              return (
                <li key={row.key} className="flex items-center gap-3 px-4 py-2 sm:px-5">
                  <StoreName storeNo={row.storeNo} name={row.name} className="min-w-0 flex-1" />
                  {row.detail && <span className="shrink-0 text-[11px] tabular-nums text-slate-400">{row.detail}</span>}
                  {rowBand && row.rate !== null ? (
                    <CountChip tone={rowBand}>{row.rate}%</CountChip>
                  ) : (
                    <CountChip tone="neutral">No shift</CountChip>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {!loading && <MoreLink href={href} count={total - rows.length} noun={noun} />}
      </div>
    </section>
  );
}
