'use client';
// components/bin-check/shared.tsx — small pieces shared by the Ops and Audit "Progres Cek Bin" pages
// (BinProgressOverview / BinProgressDetail): the month switcher, KPI tiles, progress bar, status chips and the
// line that says where the store's BC bin list stands. Colours come from lib/status-theme.ts TONES.

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, CloudOff, Loader2 } from 'lucide-react';

import { cn } from '@/lib/utils';
import { TONES, rateTone, type Tone } from '@/lib/status-theme';
import { jakartaTime, jakartaDateKey, jakartaTodayKey } from '@/lib/day-bucket';
import {
  PHASE_LABEL,
  monthLabel,
  shiftYearMonth,
  shortDay,
  type BinListSync,
  type BinProgressPhase,
  type BinRoundStatus,
} from '@/lib/bin-round';

// ─── Panels ──────────────────────────────────────────────────────────────────

export type RoundPanel = 'ops' | 'audit';

/** Where each panel's pages and API live. Audit also links a bin to the day's full BC scan (Hasil Cek Bin). */
export const PANEL_ROUTES: Record<RoundPanel, { api: string; page: string; scope: string; dayHref?: (storeId: number, date: string) => string }> = {
  ops: { api: '/api/ops/bin-check', page: '/ops/bin-check', scope: 'OPS · Operations' },
  audit: {
    api: '/api/audit/bin-progress',
    page: '/audit/bin-progress',
    scope: 'Audit · Cek Bin & SO',
    dayHref: (storeId, date) => `/audit/cek-bin/${storeId}/${date}`,
  },
};

export const withMonth = (path: string, month: string) => (month === currentYearMonth() ? path : `${path}?month=${month}`);

// ─── Data ────────────────────────────────────────────────────────────────────

/** GET a `{ success, data }` route; `reload(true)` adds `refresh=1` (BC read again). */
export function useRoundFeed<T>(url: string | null) {
  const [tick, setTick] = useState<{ n: number; force: boolean }>({ n: 0, force: false });
  // `key` = the request the current answer belongs to; loading = the answer is not for the latest request yet.
  const [state, setState] = useState<{ key: string | null; url: string | null; data: T | null; error: string | null }>({
    key: null,
    url: null,
    data: null,
    error: null,
  });
  const key = url ? `${url}#${tick.n}` : null;

  useEffect(() => {
    if (!url) return;
    let alive = true;
    const requestKey = `${url}#${tick.n}`;
    const full = tick.force ? `${url}${url.includes('?') ? '&' : '?'}refresh=1` : url;
    fetch(full, { cache: 'no-store' })
      .then(async (res) => {
        const json = (await res.json().catch(() => ({}))) as { success?: boolean; data?: T; error?: string };
        if (!res.ok || !json.success || !json.data) throw new Error(json.error || `HTTP ${res.status}`);
        if (alive) setState({ key: requestKey, url, data: json.data, error: null });
      })
      .catch((e: unknown) => {
        if (alive) setState((s) => ({ key: requestKey, url, data: s.url === url ? s.data : null, error: e instanceof Error ? e.message : 'Gagal memuat.' }));
      });
    return () => {
      alive = false;
    };
  }, [url, tick]);

  const reload = useCallback((force = false) => setTick((t) => ({ n: t.n + 1, force })), []);
  // A reload of the same page keeps showing the last answer; another month/store starts empty.
  const sameUrl = state.url === url;
  return { data: sameUrl ? state.data : null, error: sameUrl ? state.error : null, loading: state.key !== key, reload };
}

// ─── Month ───────────────────────────────────────────────────────────────────

export function currentYearMonth(): string {
  return jakartaTodayKey().slice(0, 7);
}

export function MonthSwitcher({ value, onChange }: { value: string; onChange: (ym: string) => void }) {
  const current = currentYearMonth();
  const btn =
    'flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 disabled:opacity-30 disabled:hover:bg-transparent';
  return (
    <div className="flex h-10 items-center gap-0.5 rounded-xl border border-slate-200 bg-white px-0.5">
      <button type="button" className={btn} onClick={() => onChange(shiftYearMonth(value, -1))} aria-label="Bulan sebelumnya">
        <ChevronLeft className="h-4 w-4" />
      </button>
      <span className="min-w-[8.5rem] text-center text-sm font-bold text-slate-800">{monthLabel(value)}</span>
      <button
        type="button"
        className={btn}
        onClick={() => onChange(shiftYearMonth(value, 1))}
        disabled={value >= current}
        aria-label="Bulan berikutnya"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}

// ─── Figures ─────────────────────────────────────────────────────────────────

export function KpiTile({ label, value, hint, tone = 'neutral', children }: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone; children?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <p className="truncate text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={cn('mt-1 text-2xl font-black tabular-nums', tone === 'neutral' ? 'text-slate-900' : TONES[tone].strong)}>{value}</p>
      {hint && <p className="mt-0.5 truncate text-xs text-slate-500">{hint}</p>}
      {children}
    </div>
  );
}

export function ProgressBar({ pct, className }: { pct: number | null; className?: string }) {
  return (
    <div className={cn('h-2 overflow-hidden rounded-full bg-slate-100', className)}>
      <div className={cn('h-full rounded-full transition-[width]', TONES.active.dot)} style={{ width: `${Math.max(0, Math.min(100, pct ?? 0))}%` }} />
    </div>
  );
}

/** Accuracy as a coloured figure (≥ 80 green · ≥ 50 amber · else red, like every rate in the app). */
export function accuracyTone(pct: number | null): Tone {
  return pct == null ? 'muted' : rateTone(pct);
}

// ─── Chips ───────────────────────────────────────────────────────────────────

export const STATUS_LOOK: Record<BinRoundStatus, { label: string; tone: Tone }> = {
  pending: { label: 'Belum dicek', tone: 'muted' },
  correct: { label: 'Benar', tone: 'success' },
  wrong: { label: 'Salah', tone: 'danger' },
};

export function StatusChip({ status, children }: { status: BinRoundStatus; children?: ReactNode }) {
  const look = STATUS_LOOK[status];
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-bold', TONES[look.tone].chip)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', TONES[look.tone].dot)} />
      {children ?? look.label}
    </span>
  );
}

export const PHASE_TONE: Record<BinProgressPhase, Tone> = {
  no_list: 'muted',
  not_started: 'warning',
  running: 'active',
  done: 'success',
};

export function PhaseChip({ phase }: { phase: BinProgressPhase }) {
  const tone = PHASE_TONE[phase];
  return <span className={cn('inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-bold', TONES[tone].chip)}>{PHASE_LABEL[phase]}</span>;
}

// ─── Bin list from BC ────────────────────────────────────────────────────────

export function fmtWhen(isoText: string | null): string {
  if (!isoText) return '—';
  const day = jakartaDateKey(isoText);
  return `${shortDay(day)} ${jakartaTime(isoText)}`;
}

/** "318 bin di BC · DISPLAY tidak dicek · diperbarui 19 Nov 09:43", or what is happening with the list. */
export function BinListLine({ sync, excluded, className }: { sync: BinListSync; excluded?: readonly string[]; className?: string }) {
  if (sync.state === 'syncing') {
    return (
      <span className={cn('inline-flex items-center gap-1.5 text-xs font-semibold', TONES.info.text, className)}>
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Mengambil daftar bin dari BC…
      </span>
    );
  }
  if (sync.state === 'failed') {
    return (
      <span className={cn('inline-flex items-center gap-1.5 text-xs font-semibold', TONES.danger.text, className)} title={sync.error ?? undefined}>
        <CloudOff className="h-3.5 w-3.5" /> Daftar bin gagal diambil dari BC{sync.syncedAt ? ` (terakhir ${fmtWhen(sync.syncedAt)})` : ''}
      </span>
    );
  }
  if (sync.state === 'never') return <span className={cn('text-xs text-slate-400', className)}>Daftar bin belum diambil dari BC</span>;
  if (!sync.binCount) return <span className={cn('text-xs text-slate-500', className)}>BC belum punya bin untuk toko ini · dicek {fmtWhen(sync.syncedAt)}</span>;
  return (
    <span className={cn('text-xs text-slate-500', className)}>
      {(sync.binCount ?? 0).toLocaleString('id-ID')} bin di BC
      {excluded?.length ? ` · ${excluded.join(', ')} tidak dicek` : ''} · diperbarui {fmtWhen(sync.syncedAt)}
    </span>
  );
}

export function Panel({ title, meta, action, children, className }: { title: ReactNode; meta?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-2xl border border-slate-200 bg-white shadow-sm', className)}>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-slate-100 px-4 py-3 sm:px-5">
        <h2 className="text-sm font-bold text-slate-900">{title}</h2>
        {meta && <span className="text-xs text-slate-500">{meta}</span>}
        {action && <div className="ml-auto">{action}</div>}
      </header>
      {children}
    </section>
  );
}

export function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3 text-sm', TONES.danger.chip)}>
      <CloudOff className="h-4 w-4" />
      <span className="flex-1">{message}</span>
      <button type="button" onClick={onRetry} className="rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50">
        Coba lagi
      </button>
    </div>
  );
}
