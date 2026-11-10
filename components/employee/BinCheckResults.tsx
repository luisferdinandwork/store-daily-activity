'use client';
// components/employee/BinCheckResults.tsx
//
// Cek Bin · "Hasil scan BC": what Business Central says was WRONG in the bins the
// store scanned that day, as one small table per kind of mistake (Qty kurang · Qty lebih ·
// Salah bin · Item tidak ditemukan). Correct results are never listed — if everything
// is right there is a friendly all-clear instead of empty tables. A BC outage / missing
// setup shows a calm "belum tersedia" card; it never blocks the task itself.
//
// One panel, two readers (rules in lib/bin-check.ts):
//   • staff, on their own task page      → { taskId }       GET /api/employee/tasks/cek-bin/results
//   • Ops / IT / PIC, in the task detail → { storeId, date } GET /api/tasks/cek-bin/results
// `audience` only changes the wording ("kerja bagus!" vs a neutral report).

import { useCallback, useEffect, useMemo, useState, type ComponentType } from 'react';
import {
  ArrowDown, ArrowRightLeft, ArrowUp, CheckCircle2, ChevronDown, CircleHelp, CloudOff, RefreshCw, ScanLine, SearchX,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  BIN_CHECK_REASON_META,
  groupIssuesByReason,
  issueSku,
  type BinCheckIssue,
  type BinCheckReason,
  type BinCheckResult,
} from '@/lib/bin-check';
import { Card, Notice, Section, SkeletonBlocks } from '@/components/employee/ui';

/** Rows a section shows before "Lihat semua" — keeps one long list from burying the others. */
const PREVIEW_ROWS = 5;

/** Where the panel gets its data: the staff's task (by id) or a store + Jakarta day (reviewers). */
export type BinCheckSource =
  | { taskId: string }
  | { storeId: number; date: string };

function endpointFor(source: BinCheckSource, force: boolean): string {
  const base = 'taskId' in source
    ? `/api/employee/tasks/cek-bin/results?taskId=${encodeURIComponent(source.taskId)}`
    : `/api/tasks/cek-bin/results?storeId=${source.storeId}&date=${encodeURIComponent(source.date)}`;
  return force ? `${base}&refresh=1` : base;
}

/** How each kind of mistake looks: icon, soft tile + count pill colours, and the colour of a wrong "Scan qty". */
const LOOK: Record<
  BinCheckReason,
  { icon: ComponentType<{ className?: string }>; tile: string; pill: string; scanQty: string }
> = {
  qty_lower:  { icon: ArrowDown,      tile: 'bg-amber-50 text-amber-600',  pill: 'bg-amber-50 text-amber-700',  scanQty: 'text-amber-600' },
  qty_higher: { icon: ArrowUp,        tile: 'bg-sky-50 text-sky-600',      pill: 'bg-sky-50 text-sky-700',      scanQty: 'text-sky-600' },
  misplaced:  { icon: ArrowRightLeft, tile: 'bg-primary/10 text-primary',  pill: 'bg-primary/10 text-primary',  scanQty: 'text-primary' },
  not_found:  { icon: SearchX,        tile: 'bg-red-50 text-red-600',      pill: 'bg-red-50 text-red-700',      scanQty: 'text-red-600' },
  unknown:    { icon: CircleHelp,     tile: 'bg-secondary text-muted-foreground', pill: 'bg-secondary text-muted-foreground', scanQty: 'text-foreground' },
};

function dayLabel(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  if (!y || !m || !d) return day;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('id-ID', {
    day: 'numeric', month: 'short', timeZone: 'UTC',
  });
}

const qty = (n: number | null) => (n == null ? '–' : n.toLocaleString('id-ID'));

// ─── One table per reason ────────────────────────────────────────────────────

function IssueRow({ issue, scanQtyClass }: { issue: BinCheckIssue; scanQtyClass: string }) {
  const qtyDiffers = issue.scanQuantity != null && issue.binQuantity != null && issue.scanQuantity !== issue.binQuantity;

  return (
    <tr className="align-top">
      <td className="py-2.5 pl-4 pr-2">
        {/* wraps after the hyphen first; only a code too long for the column is cut anywhere */}
        <p className="text-xs font-semibold text-foreground [overflow-wrap:anywhere]">{issueSku(issue)}</p>
        {issue.reason === 'unknown' && issue.statusText && (
          <p className="mt-0.5 break-words text-[10px] text-muted-foreground">Status BC: {issue.statusText}</p>
        )}
      </td>
      <td className="px-1 py-2.5">
        {/* BC may list several bins an item belongs in ("GDM1A3|GDM1B1|GDM1B2-D1") — one per line */}
        {issue.correctBins.map((bin) => (
          <p key={bin} className="break-all font-mono text-[11px] font-bold leading-snug text-foreground">{bin}</p>
        ))}
      </td>
      <td className="px-1 py-2.5">
        <p className="break-all font-mono text-[11px] text-muted-foreground">{issue.binCode}</p>
      </td>
      <td className={cn('px-1 py-2.5 text-center text-sm font-bold tabular-nums', qtyDiffers ? scanQtyClass : 'text-foreground')}>
        {qty(issue.scanQuantity)}
      </td>
      <td className="py-2.5 pl-1 pr-3 text-center text-sm font-bold tabular-nums text-foreground">
        {qty(issue.binQuantity)}
      </td>
    </tr>
  );
}

function ReasonSection({ reason, issues }: { reason: BinCheckReason; issues: BinCheckIssue[] }) {
  const [expanded, setExpanded] = useState(false);
  const meta = BIN_CHECK_REASON_META[reason];
  const look = LOOK[reason];
  const Icon = look.icon;
  const shown = expanded ? issues : issues.slice(0, PREVIEW_ROWS);

  return (
    <Card className="overflow-hidden">
      <header className="flex items-start gap-3 px-4 py-3.5">
        <span className={cn('flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl', look.tile)}>
          <Icon className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-foreground">{meta.label}</h3>
            <span className={cn('flex-shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums', look.pill)}>
              {issues.length}
            </span>
          </div>
          <p className="mt-0.5 text-pretty text-xs leading-snug text-muted-foreground">{meta.hint}</p>
        </div>
      </header>

      <table className="w-full table-fixed border-t border-border text-left">
        <caption className="sr-only">{meta.label}</caption>
        <colgroup>
          <col />
          <col className="w-[16%]" />
          <col className="w-[16%]" />
          <col className="w-[12%]" />
          <col className="w-[12%]" />
        </colgroup>
        <thead>
          <tr className="bg-secondary/50 text-[10px] font-semibold leading-tight text-muted-foreground">
            <th scope="col" className="py-2 pl-4 pr-2">SKU</th>
            <th scope="col" className="px-1 py-2">Bin benar</th>
            <th scope="col" className="px-1 py-2">Bin scan</th>
            <th scope="col" className="px-1 py-2 text-center">Scan qty</th>
            <th scope="col" className="py-2 pl-1 pr-3 text-center">Bin qty</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {shown.map((issue) => <IssueRow key={issue.key} issue={issue} scanQtyClass={look.scanQty} />)}
        </tbody>
      </table>

      {issues.length > PREVIEW_ROWS && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center justify-center gap-1.5 border-t border-border py-2.5 text-xs font-semibold text-muted-foreground transition-colors active:bg-secondary"
        >
          {expanded ? 'Tampilkan lebih sedikit' : `Lihat semua (${issues.length})`}
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-180')} />
        </button>
      )}
    </Card>
  );
}

// ─── Section ─────────────────────────────────────────────────────────────────

export default function BinCheckResults(
  props: BinCheckSource & { audience?: 'employee' | 'review' },
) {
  const audience = props.audience ?? 'employee';
  const review = audience === 'review';
  // Primitives only, so the load callback below stays stable across renders.
  const taskId = 'taskId' in props ? props.taskId : null;
  const storeId = 'storeId' in props ? props.storeId : null;
  const date = 'date' in props ? props.date : null;

  const [data, setData] = useState<BinCheckResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async (force = false) => {
    setLoading(true);
    try {
      const source: BinCheckSource = taskId != null ? { taskId } : { storeId: storeId!, date: date! };
      const res = await fetch(endpointFor(source, force), { cache: 'no-store', signal: AbortSignal.timeout(30_000) });
      const json = (await res.json()) as { success?: boolean; data?: BinCheckResult };
      if (!res.ok || !json.success || !json.data) throw new Error(`HTTP ${res.status}`);
      setData(json.data);
      setFailed(false);
    } catch (e) {
      console.error('[BinCheckResults] load error:', e);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [taskId, storeId, date]);

  useEffect(() => { load(); }, [load]);

  const issues = useMemo(() => data?.issues ?? [], [data]);
  const groups = useMemo(() => groupIssuesByReason(issues), [issues]);

  const refresh = (
    <button
      type="button"
      onClick={() => load(true)}
      disabled={loading}
      aria-label="Muat ulang hasil scan"
      className="flex h-7 items-center gap-1 rounded-lg bg-secondary px-2 text-[11px] font-semibold text-muted-foreground transition-colors active:bg-border disabled:opacity-50"
    >
      <RefreshCw className={cn('h-3 w-3', loading && 'animate-spin')} />
      Muat ulang
    </button>
  );

  let body;
  if (loading && !data) {
    body = <SkeletonBlocks count={1} className="h-28" />;
  } else if (failed || !data || data.state !== 'ok') {
    body = (
      <Notice tone="neutral" icon={CloudOff} title="Data hasil scan belum tersedia">
        {review
          ? 'Hasil dari Business Central belum bisa dimuat sekarang. Coba muat ulang sebentar lagi.'
          : 'Hasil dari Business Central belum bisa dimuat sekarang. Task Cek BIN tetap bisa dikerjakan — coba muat ulang sebentar lagi.'}
      </Notice>
    );
  } else if (data.checkedBins === 0) {
    body = (
      <Card className="flex items-start gap-3 px-4 py-4">
        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-secondary text-primary">
          <ScanLine className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-bold text-foreground">Belum ada hasil scan</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            {review
              ? `Belum ada BIN yang di-scan di BC pada ${dayLabel(data.day)}.`
              : `Hasil akan muncul di sini setelah BIN di-scan di BC pada ${dayLabel(data.day)}.`}
          </p>
        </div>
      </Card>
    );
  } else if (issues.length === 0) {
    body = (
      <div className="flex items-start gap-3 rounded-2xl border border-green-200 bg-green-50 px-4 py-4">
        <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-green-600" />
        <div className="min-w-0">
          <p className="text-sm font-bold text-green-800">
            Semua hasil scan sudah benar{review ? '' : ' 🎉'}
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-green-700">
            {data.checkedBins} BIN sudah dicek dan tidak ada yang perlu diperbaiki.{review ? '' : ' Kerja bagus!'}
          </p>
        </div>
      </div>
    );
  } else {
    body = (
      <div className="space-y-3">
        {!data.quantitiesAvailable && (
          <Notice tone="info">
            Jumlah scan belum bisa ditampilkan sekarang. Daftar di bawah diambil dari ringkasan BC.
          </Notice>
        )}
        {groups.map((g) => <ReasonSection key={g.reason} reason={g.reason} issues={g.issues} />)}
      </div>
    );
  }

  return (
    <Section title="Hasil scan BC" meta={data?.state === 'ok' ? dayLabel(data.day) : undefined} action={refresh}>
      {body}
    </Section>
  );
}
