'use client';
// app/finance/store-closing/page.tsx
//
// Finance · Store Closing
//
// A read-mostly view of how stores closed, built for two questions:
//   1. Where is the photo of the Z-Report and EDC Settlement?
//   2. Was the Open Statement POSTED or put ON HOLD?
//
// Statements that are ON HOLD stay in a panel at the top whatever the date —
// they don't go away when the day changes — with the reason and the state of
// the Ops issue behind them. Once the problem is fixed, "Tandai Posted" flips
// the statement to posted, completes the closing and closes that issue.
//
// Same sheet layout as the other Finance pages: one row per store scheduled to
// close on the chosen day; click a row for the checklist and hold history.

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  FileSpreadsheet,
  ImageOff,
  Loader2,
  PauseCircle,
  RefreshCw,
  Search,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  STATEMENT_META,
  STATEMENT_ORDER,
  deriveStatement,
  fmtDateLong,
  fmtDateShort,
  fmtDateTime,
  groupRowsByCode,
  todayJakarta,
  type StatementState,
  type StoreClosingRow,
} from '@/lib/store-closing-review';
import {
  SHEET_ROW_HEAD as ROW_HEAD,
  SHEET_TD as TD,
  SHEET_TH as TH,
} from '@/components/finance/petty-cash/shared';
import {
  CodeChips,
  DayNavigator,
  KpiStrip,
  PhotoLightbox,
} from '@/components/finance/shared/sheet-kit';

const COLS = 8;

interface Line {
  row: StoreClosingRow;
  state: StatementState;
}

// ─── Cells ───────────────────────────────────────────────────────────────────

function StatementBadge({ state }: { state: StatementState }) {
  const meta = STATEMENT_META[state];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset',
        meta.badge,
      )}
    >
      {state === 'on_hold' ? <PauseCircle className="h-3 w-3" /> : <span className={cn('h-1.5 w-1.5 rounded-full', meta.dot)} />}
      {meta.label}
    </span>
  );
}

/** The Z-Report & EDC settlement photo; degrades to an icon when the URL no longer loads. */
function ClosingPhoto({
  url,
  size,
  onOpen,
}: {
  url: string | null;
  size: 'sm' | 'lg';
  onOpen: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const dim = size === 'sm' ? 'h-10 w-10' : 'h-40 w-40';

  if (!url) {
    return (
      <span
        title="Foto Z-Report & EDC Settlement belum ada"
        className={cn('flex shrink-0 flex-col items-center justify-center gap-1 rounded-md border border-dashed border-slate-300 bg-slate-50 text-slate-400', dim)}
      >
        <Camera className={size === 'sm' ? 'h-4 w-4' : 'h-6 w-6'} />
        {size === 'lg' && <span className="text-[11px] font-semibold">Belum ada foto</span>}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onOpen(); }}
      title="Lihat foto Z-Report & EDC Settlement"
      className={cn('shrink-0 overflow-hidden rounded-md border border-slate-300 bg-slate-100 transition hover:border-emerald-500', dim)}
    >
      {failed ? (
        <span className="flex h-full w-full items-center justify-center text-slate-400" title="Foto gagal dimuat">
          <ImageOff className="h-1/3 w-1/3" />
        </span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="Z-Report & EDC Settlement" loading="lazy" onError={() => setFailed(true)} className="h-full w-full object-cover" />
      )}
    </button>
  );
}

/** "Tandai Posted" with an inline confirm — the flip can't be undone from here. */
function FixButton({
  row,
  busy,
  confirming,
  onAsk,
  onCancel,
  onConfirm,
}: {
  row: StoreClosingRow;
  busy: boolean;
  confirming: boolean;
  onAsk: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!row.canFix) return null;

  if (confirming) {
    return (
      <span className="flex flex-wrap items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
        <span className="text-[11px] font-medium text-slate-700">Sudah diperbaiki & Posted?</span>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className="inline-flex h-7 items-center gap-1 rounded-md bg-emerald-600 px-2.5 text-[11px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
          Ya
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="h-7 rounded-md border border-slate-300 bg-white px-2 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
        >
          Batal
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onAsk(); }}
      className="inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-md bg-emerald-600 px-2.5 text-[11px] font-semibold text-white hover:bg-emerald-700"
    >
      <CircleCheck className="h-3 w-3" />
      Tandai Posted
    </button>
  );
}

const ISSUE_LABEL: Record<string, string> = {
  draft: 'Draft',
  reported: 'Dilaporkan',
  in_review: 'Ditinjau',
  solved: 'Solved',
  completed: 'Selesai',
};

function IssueChip({ issue }: { issue: NonNullable<StoreClosingRow['holdIssue']> }) {
  const done = issue.status === 'completed' || issue.status === 'solved';
  return (
    <span
      title={`Issue Ops #${issue.id}`}
      className={cn(
        'inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset',
        done ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-slate-100 text-slate-600 ring-slate-200',
      )}
    >
      Issue #{issue.id} · {ISSUE_LABEL[issue.status] ?? issue.status}
    </span>
  );
}

// ─── On-hold panel ───────────────────────────────────────────────────────────

function HoldsPanel({
  holds,
  today,
  busyId,
  confirmId,
  onAsk,
  onCancel,
  onConfirm,
  onOpenPhoto,
}: {
  holds: StoreClosingRow[];
  today: string;
  busyId: number | null;
  confirmId: number | null;
  onAsk: (id: number) => void;
  onCancel: () => void;
  onConfirm: (row: StoreClosingRow) => void;
  onOpenPhoto: (row: StoreClosingRow) => void;
}) {
  if (holds.length === 0) return null;

  return (
    <section className="overflow-hidden rounded-md border border-amber-300 bg-white">
      <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-3 py-2">
        <PauseCircle className="h-4 w-4 text-amber-600" />
        <h2 className="text-sm font-semibold text-amber-900">Statement On Hold</h2>
        <span className="rounded bg-amber-200/70 px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-amber-900">{holds.length}</span>
        <span className="ml-auto text-[11px] text-amber-800">Semua tanggal — tetap di sini sampai diperbaiki</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] border-collapse text-[13px]">
          <thead>
            <tr className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <th className="border-b border-slate-200 px-3 py-2 text-left">Tanggal</th>
              <th className="border-b border-slate-200 px-3 py-2 text-left">Toko</th>
              <th className="border-b border-slate-200 px-3 py-2 text-left">Foto</th>
              <th className="border-b border-slate-200 px-3 py-2 text-left">Alasan hold</th>
              <th className="border-b border-slate-200 px-3 py-2 text-left">Ditahan</th>
              <th className="border-b border-slate-200 px-3 py-2 text-left">Issue Ops</th>
              <th className="border-b border-slate-200 px-3 py-2 text-left">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {holds.map((row) => (
              <tr key={row.taskId} className="align-top hover:bg-amber-50/30">
                <td className="border-b border-slate-100 px-3 py-2 whitespace-nowrap">
                  <p className="font-medium text-slate-800">{fmtDateShort(row.date)}</p>
                  {row.date < today && <p className="text-[11px] text-amber-700">{daysAgo(row.date, today)} hari lalu</p>}
                </td>
                <td className="border-b border-slate-100 px-3 py-2">
                  <p className="font-medium text-slate-900">{row.storeName}</p>
                  <p className="font-mono text-[11px] text-slate-500">{row.storeNo}</p>
                </td>
                <td className="border-b border-slate-100 px-3 py-2">
                  <ClosingPhoto url={row.zReportPhoto} size="sm" onOpen={() => onOpenPhoto(row)} />
                </td>
                <td className="max-w-sm border-b border-slate-100 px-3 py-2 text-slate-700">
                  {row.holdReason ?? <span className="italic text-slate-400">Tanpa alasan</span>}
                </td>
                <td className="border-b border-slate-100 px-3 py-2 text-xs text-slate-600 whitespace-nowrap">
                  <p className="font-medium text-slate-800">{row.submittedBy ?? '–'}</p>
                  <p>{fmtDateTime(row.heldAt)}</p>
                </td>
                <td className="border-b border-slate-100 px-3 py-2">
                  {row.holdIssue ? <IssueChip issue={row.holdIssue} /> : <span className="text-slate-300">–</span>}
                </td>
                <td className="border-b border-slate-100 px-3 py-2">
                  <FixButton
                    row={row}
                    busy={busyId === row.taskId}
                    confirming={confirmId === row.taskId}
                    onAsk={() => row.taskId != null && onAsk(row.taskId)}
                    onCancel={onCancel}
                    onConfirm={() => onConfirm(row)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function daysAgo(from: string, to: string): number {
  return Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000);
}

// ─── Detail panel ────────────────────────────────────────────────────────────

function CheckLine({ done, label }: { done: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2 py-1 text-xs">
      <CheckCircle2 className={cn('h-3.5 w-3.5', done ? 'text-emerald-500' : 'text-slate-300')} />
      <span className={done ? 'text-slate-800' : 'text-slate-400'}>{label}</span>
    </li>
  );
}

function DetailPanel({
  line,
  onOpenPhoto,
  fix,
}: {
  line: Line;
  onOpenPhoto: () => void;
  fix: React.ReactNode;
}) {
  const { row, state } = line;

  return (
    <div className="grid gap-px bg-slate-300 lg:grid-cols-[auto_minmax(0,1fr)_minmax(0,1.2fr)]">
      <section className="bg-white p-4">
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Z-Report & EDC Settlement</h3>
        <ClosingPhoto url={row.zReportPhoto} size="lg" onOpen={onOpenPhoto} />
        {row.photoAt && <p className="mt-1.5 text-[11px] text-slate-500">Diunggah {fmtDateTime(row.photoAt)}</p>}
      </section>

      <section className="bg-white p-4">
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Checklist toko</h3>
        <ul className="divide-y divide-slate-100">
          <CheckLine done={row.eodZReportDone} label="EOD Z-Report" />
          <CheckLine done={row.edcSettlementDone} label="EDC settlement" />
          <CheckLine done={row.edcSummaryDone} label="EDC summary" />
        </ul>
        <p className="mt-3 text-xs text-slate-600">
          Jadwal tutup: {row.scheduledStaff.length > 0 ? row.scheduledStaff.map((s) => s.name).join(', ') : '–'}
        </p>
        {row.notes && (
          <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
            <span className="font-semibold text-slate-800">Catatan: </span>
            {row.notes}
          </div>
        )}
      </section>

      <section className="bg-white p-4">
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Open Statement</h3>
        <div className="flex flex-wrap items-center gap-2">
          <StatementBadge state={state} />
          {row.holdIssue && <IssueChip issue={row.holdIssue} />}
        </div>

        <dl className="mt-3 divide-y divide-slate-100 text-xs">
          {row.submittedBy && (
            <div className="flex justify-between gap-3 py-1">
              <dt className="text-slate-500">Disubmit</dt>
              <dd className="text-right text-slate-800">
                <span className="font-medium">{row.submittedBy}</span>
                {row.completedAt && <span className="text-slate-500"> · {fmtDateTime(row.completedAt)}</span>}
              </dd>
            </div>
          )}
          {(row.isOnHold || row.holdResolvedAt || row.reopened) && (
            <div className="flex justify-between gap-3 py-1">
              <dt className="text-slate-500">Ditahan</dt>
              <dd className="text-right text-slate-800">{fmtDateTime(row.heldAt) ?? '–'}</dd>
            </div>
          )}
          {row.holdResolvedAt && (
            <div className="flex justify-between gap-3 py-1">
              <dt className="text-slate-500">{row.fixedBy ? 'Diperbaiki Finance' : 'Hold selesai'}</dt>
              <dd className="text-right text-slate-800">
                {row.fixedBy && <span className="font-medium">{row.fixedBy} · </span>}
                {fmtDateTime(row.fixedAt ?? row.holdResolvedAt)}
              </dd>
            </div>
          )}
        </dl>

        {(row.isOnHold || row.holdReason) && (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <span className="font-semibold">Alasan hold: </span>
            {row.holdReason ?? 'Tanpa alasan.'}
          </div>
        )}

        {state === 'reopened' && (
          <p className="mt-3 text-[11px] text-sky-700">Ops sudah menyelesaikan issue — toko tinggal memposting statement lagi.</p>
        )}

        {row.canFix && <div className="mt-3">{fix}</div>}
      </section>
    </div>
  );
}

// ─── Sheet row ───────────────────────────────────────────────────────────────

function StoreLine({
  line,
  index,
  expanded,
  busy,
  confirming,
  onToggle,
  onAsk,
  onCancel,
  onConfirm,
  onOpenPhoto,
}: {
  line: Line;
  index: number;
  expanded: boolean;
  busy: boolean;
  confirming: boolean;
  onToggle: () => void;
  onAsk: () => void;
  onCancel: () => void;
  onConfirm: () => void;
  onOpenPhoto: () => void;
}) {
  const { row, state } = line;
  const tint =
    state === 'on_hold' ? 'bg-amber-50/60 hover:bg-amber-50'
    : state === 'not_submitted' ? 'bg-rose-50/60 hover:bg-rose-50'
    : state === 'reopened' ? 'bg-sky-50/50 hover:bg-sky-50'
    : 'bg-white hover:bg-emerald-50/40';

  const fix = (
    <FixButton row={row} busy={busy} confirming={confirming} onAsk={onAsk} onCancel={onCancel} onConfirm={onConfirm} />
  );

  return (
    <>
      <tr onClick={onToggle} className={cn('cursor-pointer text-[13px]', tint)}>
        <td className={cn(ROW_HEAD, 'w-11')}>{index}</td>
        <td className={cn(TD, 'w-20 whitespace-nowrap font-mono text-xs font-semibold text-slate-600')}>{row.storeNo}</td>
        <td className={cn(TD, 'min-w-56')}>
          <p className="font-medium text-slate-900">{row.storeName}</p>
          <p className="text-[11px] text-slate-500">
            {row.areaName}
            {row.scheduledStaff.length > 0 && ` · ${row.scheduledStaff.map((s) => s.name).join(', ')}`}
          </p>
        </td>
        <td className={cn(TD, 'w-24')}>
          <ClosingPhoto url={row.zReportPhoto} size="sm" onOpen={onOpenPhoto} />
        </td>
        <td className={cn(TD, 'w-44')}>
          <StatementBadge state={state} />
        </td>
        <td className={cn(TD, 'min-w-56 max-w-xs')}>
          {row.isOnHold || (row.holdReason && row.holdResolvedAt) ? (
            <span className="line-clamp-2 text-xs text-slate-700" title={row.holdReason ?? undefined}>
              {row.holdReason ?? 'Tanpa alasan'}
            </span>
          ) : (
            <span className="text-slate-300">–</span>
          )}
        </td>
        <td className={cn(TD, 'w-52')} onClick={(e) => e.stopPropagation()}>
          {row.canFix ? fix : <span className="text-xs text-slate-500">{row.submittedBy ? `${row.submittedBy}${row.completedAt ? ` · ${fmtDateTime(row.completedAt)}` : ''}` : '–'}</span>}
        </td>
        <td className={cn(TD, 'w-9 text-center text-slate-400')}>
          <button
            type="button"
            aria-expanded={expanded}
            aria-label={expanded ? 'Tutup detail' : 'Buka detail'}
            onClick={(e) => { e.stopPropagation(); onToggle(); }}
            className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100 hover:text-slate-700"
          >
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </td>
      </tr>

      {expanded && (
        <tr>
          <td colSpan={COLS} className="border-b border-slate-300 bg-slate-100 p-0">
            {/* The sheet may scroll sideways — pin the panel to the visible width. */}
            <div className="sticky left-0 w-[100cqw]">
              <DetailPanel line={line} onOpenPhoto={onOpenPhoto} fix={fix} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function FinanceStoreClosingPage() {
  const [date, setDate] = useState(todayJakarta);
  const [rows, setRows] = useState<StoreClosingRow[]>([]);
  const [holds, setHolds] = useState<StoreClosingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [code, setCode] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [stateFilter, setStateFilter] = useState<StatementState | ''>('');
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [lightbox, setLightbox] = useState<{ title: string; url: string } | null>(null);

  const today = todayJakarta();
  const isPast = date < today;

  useEffect(() => {
    let stale = false;
    setLoading(true);
    setError(null);

    fetch(`/api/finance/store-closing?date=${date}`, { cache: 'no-store' })
      .then((res) => res.json())
      .then((body) => {
        if (stale) return;
        if (body.success) {
          setRows(body.rows);
          setHolds(body.holds);
        } else {
          setError(body.error ?? 'Gagal memuat data.');
        }
      })
      .catch(() => { if (!stale) setError('Network error.'); })
      .finally(() => { if (!stale) setLoading(false); });

    return () => { stale = true; };
  }, [date, reloadKey]);

  function changeDate(next: string) {
    setDate(next);
    setExpanded(new Set());
    setConfirmId(null);
  }

  const lines: Line[] = useMemo(
    () => rows.map((row) => ({ row, state: deriveStatement(row, isPast) })),
    [rows, isPast],
  );

  // Chips + counts come from every store, so they don't shrink as you search.
  const allGroups = useMemo(() => groupRowsByCode(rows), [rows]);
  const stateCounts = useMemo(() => {
    const counts = new Map<StatementState, number>();
    for (const l of lines) counts.set(l.state, (counts.get(l.state) ?? 0) + 1);
    return counts;
  }, [lines]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return lines.filter(({ row, state }) => {
      if (code && row.code !== code) return false;
      if (stateFilter && state !== stateFilter) return false;
      if (!q) return true;
      return [row.storeNo, row.storeName, row.areaName, row.submittedBy, row.holdReason, ...row.scheduledStaff.map((s) => s.name)]
        .some((v) => v?.toLowerCase().includes(q));
    });
  }, [lines, code, stateFilter, search]);

  const submitted = rows.filter((r) => r.status === 'completed').length;
  const posted = lines.filter((l) => l.state === 'posted' || l.state === 'posted_after_hold').length;
  const notSubmitted = lines.filter((l) => l.state === 'not_submitted').length;
  const noPhoto = rows.filter((r) => r.status === 'completed' && !r.zReportPhoto).length;
  const filtered = Boolean(code || search || stateFilter);

  const toggleExpanded = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  async function fix(row: StoreClosingRow) {
    if (row.taskId == null) return;
    setBusyId(row.taskId);
    try {
      const res = await fetch(`/api/finance/store-closing/${row.taskId}/fix`, { method: 'POST' });
      const body = await res.json();
      if (body.success) toast.success(`Statement ${row.storeName} ditandai Posted.`);
      else toast.error(body.error ?? 'Gagal memproses.');
      setReloadKey((k) => k + 1);
    } catch {
      toast.error('Network error.');
    } finally {
      setBusyId(null);
      setConfirmId(null);
    }
  }

  const openPhoto = (row: StoreClosingRow) =>
    row.zReportPhoto && setLightbox({ title: `${row.storeNo} · ${row.storeName}`, url: row.zReportPhoto });

  return (
    <div className="min-h-full bg-slate-50">
      {lightbox && (
        <PhotoLightbox
          title={lightbox.title}
          photos={[{ url: lightbox.url, label: 'Z-Report & EDC Settlement' }]}
          index={0}
          onIndex={() => {}}
          onClose={() => setLightbox(null)}
        />
      )}

      {/* Header */}
      <div className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-[1400px] px-6 py-4 lg:px-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-600">
                Finance · Operations
              </p>
              <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-slate-900">Store Closing</h1>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <DayNavigator date={date} onChange={changeDate} />
              <button
                type="button"
                onClick={() => setReloadKey((k) => k + 1)}
                disabled={loading}
                className="flex h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
              >
                <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
                Refresh
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-[1400px] space-y-4 px-6 py-5 lg:px-8">
        {/* Key numbers */}
        {!loading && !error && (
          <KpiStrip
            items={[
              { label: 'Toko tutup', value: String(rows.length), sub: `${submitted} sudah submit` },
              { label: 'Statement Posted', value: String(posted), sub: 'pada hari ini yang dipilih' },
              { label: 'Statement On Hold', value: String(holds.length), sub: 'semua tanggal, belum diperbaiki', warn: holds.length > 0 },
              { label: 'Belum submit', value: String(notSubmitted), sub: isPast ? 'hari sudah lewat' : 'akan ditandai setelah hari berganti', warn: notSubmitted > 0 },
              { label: 'Foto belum ada', value: String(noPhoto), sub: 'sudah submit tanpa foto Z-Report & EDC', warn: noPhoto > 0 },
            ]}
          />
        )}

        {error && (
          <div className="flex items-center gap-3 rounded-md border border-rose-200 bg-rose-50 px-4 py-3">
            <AlertTriangle className="h-4 w-4 shrink-0 text-rose-500" />
            <p className="text-sm font-medium text-rose-700">{error}</p>
          </div>
        )}

        {/* Holds — every date */}
        {!loading && !error && (
          <HoldsPanel
            holds={holds}
            today={today}
            busyId={busyId}
            confirmId={confirmId}
            onAsk={setConfirmId}
            onCancel={() => setConfirmId(null)}
            onConfirm={(row) => void fix(row)}
            onOpenPhoto={openPhoto}
          />
        )}

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <CodeChips groups={allGroups} total={rows.length} active={code} onPick={setCode} />

          <div className="relative min-w-[200px] max-w-xs flex-1">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search store, staff, reason…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 w-full rounded-md border border-slate-300 bg-white pl-9 pr-3 text-sm placeholder-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
            />
          </div>

          <select
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value as StatementState | '')}
            aria-label="Filter statement"
            className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-700 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
          >
            <option value="">Semua status statement</option>
            {STATEMENT_ORDER.filter((s) => stateCounts.has(s)).map((s) => (
              <option key={s} value={s}>{STATEMENT_META[s].label} ({stateCounts.get(s)})</option>
            ))}
          </select>

          {filtered && (
            <button
              type="button"
              onClick={() => { setCode(null); setSearch(''); setStateFilter(''); }}
              className="text-xs font-semibold text-slate-500 underline hover:text-slate-700"
            >
              Clear
            </button>
          )}
        </div>

        {/* Sheet */}
        {loading ? (
          <div className="overflow-hidden rounded-md border border-slate-300 bg-white">
            <div className="h-9 animate-pulse bg-slate-100" />
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-14 animate-pulse border-t border-slate-100 bg-white even:bg-slate-50/60" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <div className="rounded-md border border-dashed border-slate-300 bg-white py-16 text-center">
            <FileSpreadsheet className="mx-auto mb-3 h-9 w-9 text-slate-300" />
            <p className="text-sm font-semibold text-slate-600">
              {filtered ? 'No stores match your filter.' : `Tidak ada toko dengan jadwal shift penutup pada ${fmtDateLong(date)}.`}
            </p>
          </div>
        ) : (
          <>
            <div className="@container max-h-[68vh] overflow-auto [scrollbar-gutter:stable] rounded-md border border-slate-300 bg-white">
              <table className="w-full min-w-[1000px] border-separate border-spacing-0 text-left">
                <thead>
                  <tr>
                    <th className={cn(TH, 'w-11 text-center')}>No</th>
                    <th className={cn(TH, 'text-left')}>Kode</th>
                    <th className={cn(TH, 'text-left')}>Nama Toko</th>
                    <th className={cn(TH, 'text-left')}>Foto Z-Report & EDC</th>
                    <th className={cn(TH, 'text-left')}>Open Statement</th>
                    <th className={cn(TH, 'text-left')}>Alasan Hold</th>
                    <th className={cn(TH, 'text-left')}>Aksi / Disubmit</th>
                    <th className={cn(TH, 'w-9')} />
                  </tr>
                </thead>
                <tbody>
                  {visible.map((l, i) => (
                    <StoreLine
                      key={l.row.storeId}
                      line={l}
                      index={i + 1}
                      expanded={expanded.has(l.row.storeId)}
                      busy={busyId != null && busyId === l.row.taskId}
                      confirming={confirmId != null && confirmId === l.row.taskId}
                      onToggle={() => toggleExpanded(l.row.storeId)}
                      onAsk={() => l.row.taskId != null && setConfirmId(l.row.taskId)}
                      onCancel={() => setConfirmId(null)}
                      onConfirm={() => void fix(l.row)}
                      onOpenPhoto={() => openPhoto(l.row)}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            <div className="space-y-1 text-[11px] text-slate-500">
              <p>
                Menampilkan toko yang punya jadwal shift penutup pada {fmtDateLong(date)}.{' '}
                <span className="font-semibold text-emerald-700">Posted</span> = Open Statement sudah diposting;{' '}
                <span className="font-semibold text-amber-700">On Hold</span> = ditahan toko dan menunggu perbaikan
                (Ops menerima issue-nya); <span className="font-semibold text-sky-700">Menunggu posting</span> = Ops sudah
                menyelesaikan issue, toko tinggal memposting.
              </p>
              <p>
                Setelah masalahnya beres, tekan <span className="font-semibold">Tandai Posted</span> — statement menjadi
                Posted, closing dianggap selesai, dan issue On Hold-nya ditutup. Statement On Hold dari tanggal
                sebelumnya tetap muncul di panel atas sampai diperbaiki.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
