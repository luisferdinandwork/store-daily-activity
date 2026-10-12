'use client';
// app/finance/store-closing/page.tsx
//
// Finance · Store Closing
//
// A read-mostly view of how stores closed, built for three questions:
//   1. Where is the photo of the Z-Report and EDC Settlement?
//   2. What did each bank's EDC count? Per bank, by QRIS / Debit / Credit, plus
//      OP/ME/VOUCHER and — for Indodana — the photo of its dashboard.
//   3. Was the Open Statement POSTED or put ON HOLD?
//
// Statements that are ON HOLD stay in a panel at the top whatever the date —
// they don't go away when the day changes — with the reason and the state of
// the Ops issue behind them. Once the problem is fixed, "Tandai Posted" flips
// the statement to posted, completes the closing and closes that issue.
//
// Same sheet layout as the other Finance pages: one row per store scheduled to
// close on the chosen day, one column per bank (all methods added up) with a
// totals row underneath; click a row for the bank × method breakdown, the
// photos, the checklist and the hold history.

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
import { STATUS_LABELS as ISSUE_STATUS_LABELS } from '@/lib/issues';
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
  EDC_BANKS,
  EDC_METHODS,
  EDC_METHOD_LABELS,
  INDODANA_PHOTO_LABEL,
  OP_ME_VOUCHER_LABEL,
  banksMissingPhoto,
  summariseEdc,
  type EdcSummary,
} from '@/lib/store-closing-edc';
import {
  SHEET_ROW_HEAD as ROW_HEAD,
  SHEET_TD as TD,
  SHEET_TH as TH,
  num,
  rp,
} from '@/components/finance/petty-cash/shared';
import {
  CodeChips,
  DayNavigator,
  KpiStrip,
  PhotoLightbox,
  type LightboxPhoto,
} from '@/components/finance/shared/sheet-kit';

// No · Kode · Nama · Foto · Open Statement · one per bank · OP/ME/VOUCHER · Total · Alasan · Aksi · chevron
const COLS = 10 + EDC_BANKS.length;

const ZREPORT_LABEL = 'Z-Report & EDC Settlement';

interface Line {
  row: StoreClosingRow;
  state: StatementState;
  edc: EdcSummary;
  /** Indodana has an amount but no dashboard photo. */
  indodanaMissing: boolean;
}

type PhotoKind = 'zreport' | 'indodana';

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

/** A closing photo; degrades to an icon when the URL no longer loads. */
function ClosingPhoto({
  url,
  label,
  size,
  onOpen,
}: {
  url: string | null;
  label: string;
  size: 'sm' | 'lg';
  onOpen: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const dim = size === 'sm' ? 'h-10 w-10' : 'h-40 w-40';

  if (!url) {
    return (
      <span
        title={`Foto ${label} belum ada`}
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
      title={`Lihat foto ${label}`}
      className={cn('shrink-0 overflow-hidden rounded-md border border-slate-300 bg-slate-100 transition hover:border-emerald-500', dim)}
    >
      {failed ? (
        <span className="flex h-full w-full items-center justify-center text-slate-400" title="Foto gagal dimuat">
          <ImageOff className="h-1/3 w-1/3" />
        </span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={label} loading="lazy" onError={() => setFailed(true)} className="h-full w-full object-cover" />
      )}
    </button>
  );
}

/** Next to an Indodana amount: the dashboard photo, or a warning when it should be there and isn't. */
function IndodanaPhotoMark({ line, onOpen }: { line: Line; onOpen: () => void }) {
  if (line.row.indodanaPhoto) {
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onOpen(); }}
        title={`Lihat ${INDODANA_PHOTO_LABEL.toLowerCase()}`}
        className="inline-flex h-5 w-5 items-center justify-center rounded text-emerald-600 hover:bg-emerald-50"
      >
        <Camera className="h-3.5 w-3.5" />
      </button>
    );
  }
  if (line.indodanaMissing) {
    return (
      <span title={`${INDODANA_PHOTO_LABEL} belum ada`} className="inline-flex h-5 w-5 items-center justify-center text-amber-500">
        <AlertTriangle className="h-3.5 w-3.5" />
      </span>
    );
  }
  return null;
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

// Same words as the Issues pages (lib/issues.ts).
const ISSUE_LABEL: Record<string, string> = ISSUE_STATUS_LABELS;

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
  onOpenPhoto: (row: StoreClosingRow, kind: PhotoKind) => void;
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
                  <ClosingPhoto url={row.zReportPhoto} label={ZREPORT_LABEL} size="sm" onOpen={() => onOpenPhoto(row, 'zreport')} />
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

/** Bank × QRIS / Debit / Credit, then the sum per method, OP/ME/VOUCHER and the grand total. */
function EdcMatrix({ summary }: { summary: EdcSummary }) {
  const th = 'border-b border-slate-200 bg-slate-50 px-2.5 py-1.5 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500';
  const td = 'whitespace-nowrap border-b border-slate-100 px-2.5 py-1.5 text-right tabular-nums';

  return (
    <div className="overflow-x-auto rounded-md border border-slate-200">
      <table className="w-full min-w-[420px] border-collapse text-xs">
        <thead>
          <tr>
            <th className={cn(th, 'text-left')}>Bank (Rp)</th>
            {EDC_METHODS.map((m) => <th key={m} className={th}>{EDC_METHOD_LABELS[m]}</th>)}
            <th className={th}>Total</th>
          </tr>
        </thead>
        <tbody>
          {summary.banks.map((b) => (
            <tr key={b.code}>
              <td className={cn(td, 'text-left font-semibold text-slate-800')}>{b.label}</td>
              {b.filled ? (
                EDC_METHODS.map((m) => (
                  <td key={m} className={cn(td, b.cells[m] === undefined ? 'text-slate-300' : 'text-slate-700')}>
                    {b.cells[m] === undefined ? '–' : num(b.cells[m])}
                  </td>
                ))
              ) : (
                <td colSpan={EDC_METHODS.length} className={cn(td, 'font-semibold text-amber-600')}>Belum diisi</td>
              )}
              <td className={cn(td, 'font-bold', b.filled ? 'text-slate-900' : 'text-slate-300')}>
                {b.filled ? num(b.total) : '–'}
              </td>
            </tr>
          ))}
          <tr className="bg-slate-50">
            <td className={cn(td, 'text-left font-semibold text-slate-700')}>Total EDC</td>
            {EDC_METHODS.map((m) => (
              <td key={m} className={cn(td, 'font-semibold text-slate-700')}>{num(summary.byMethod[m])}</td>
            ))}
            <td className={cn(td, 'font-bold text-slate-900')}>{num(summary.banksTotal)}</td>
          </tr>
          <tr>
            <td colSpan={EDC_METHODS.length + 1} className={cn(td, 'text-left font-semibold text-slate-800')}>
              {OP_ME_VOUCHER_LABEL}
            </td>
            <td className={cn(td, 'font-bold', summary.opMeVoucher === null ? 'text-amber-600' : 'text-slate-900')}>
              {summary.opMeVoucher === null ? 'Belum diisi' : num(summary.opMeVoucher)}
            </td>
          </tr>
          <tr className="bg-emerald-50">
            <td colSpan={EDC_METHODS.length + 1} className={cn(td, 'border-b-0 text-left font-bold text-emerald-800')}>Total</td>
            <td className={cn(td, 'border-b-0 font-bold text-emerald-800')}>{num(summary.total)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function DetailPanel({
  line,
  onOpenPhoto,
  fix,
}: {
  line: Line;
  onOpenPhoto: (kind: PhotoKind) => void;
  fix: React.ReactNode;
}) {
  const { row, state, edc } = line;
  // Closings made before the money format only have the old EDC summary tick.
  const edcComplete = edc.hasData ? edc.missingBanks.length === 0 && edc.opMeVoucher !== null : row.edcSummaryDone;

  return (
    <div className="grid gap-px bg-slate-300 lg:grid-cols-2">
      <section className="bg-white p-4">
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Rekap EDC</h3>
        {edc.hasData ? (
          <>
            <EdcMatrix summary={edc} />
            {row.edcBy && (
              <p className="mt-1.5 text-[11px] text-slate-500">
                Diisi {row.edcBy}{row.edcAt ? ` · ${fmtDateTime(row.edcAt)}` : ''}
              </p>
            )}
          </>
        ) : (
          <p className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-xs text-slate-500">
            {row.edcSummaryDone
              ? 'Closing ini dibuat sebelum rekap EDC per bank — hanya checklist “EDC summary selesai” yang tercatat.'
              : 'Toko belum mengisi rekap EDC.'}
          </p>
        )}
        {row.edcNotes && (
          <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
            <span className="font-semibold text-slate-800">Catatan EDC: </span>
            {row.edcNotes}
          </div>
        )}
      </section>

      <section className="bg-white p-4">
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Foto bukti</h3>
        <div className="flex flex-wrap gap-5">
          <figure>
            <ClosingPhoto url={row.zReportPhoto} label={ZREPORT_LABEL} size="lg" onOpen={() => onOpenPhoto('zreport')} />
            <figcaption className="mt-1.5 text-[11px] font-medium text-slate-600">{ZREPORT_LABEL}</figcaption>
            {row.photoAt && <p className="text-[11px] text-slate-400">Diunggah {fmtDateTime(row.photoAt)}</p>}
          </figure>
          <figure>
            <ClosingPhoto url={row.indodanaPhoto} label={INDODANA_PHOTO_LABEL} size="lg" onOpen={() => onOpenPhoto('indodana')} />
            <figcaption className="mt-1.5 text-[11px] font-medium text-slate-600">Dashboard Indodana</figcaption>
            {line.indodanaMissing ? (
              <p className="text-[11px] font-semibold text-amber-600">Wajib — ada transaksi Indodana</p>
            ) : !row.indodanaPhoto ? (
              <p className="text-[11px] text-slate-400">Tidak wajib — tanpa transaksi Indodana</p>
            ) : null}
          </figure>
        </div>
      </section>

      <section className="bg-white p-4">
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Checklist toko</h3>
        <ul className="divide-y divide-slate-100">
          <CheckLine done={row.eodZReportDone} label="EOD Z-Report" />
          <CheckLine done={edcComplete} label={edc.hasData ? 'Rekap EDC (semua bank + OP/ME/VOUCHER)' : 'EDC summary (format lama)'} />
          <CheckLine done={row.edcSettlementDone} label="EDC settlement" />
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
  onOpenPhoto: (kind: PhotoKind) => void;
}) {
  const { row, state, edc } = line;
  const tint =
    state === 'on_hold' ? 'bg-amber-50/60 hover:bg-amber-50'
    : state === 'not_submitted' ? 'bg-rose-50/60 hover:bg-rose-50'
    : state === 'reopened' ? 'bg-sky-50/50 hover:bg-sky-50'
    : 'bg-white hover:bg-emerald-50/40';

  const fix = (
    <FixButton row={row} busy={busy} confirming={confirming} onAsk={onAsk} onCancel={onCancel} onConfirm={onConfirm} />
  );

  const amountCell = 'whitespace-nowrap text-right tabular-nums';

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
          <ClosingPhoto url={row.zReportPhoto} label={ZREPORT_LABEL} size="sm" onOpen={() => onOpenPhoto('zreport')} />
        </td>
        <td className={cn(TD, 'w-44')}>
          <StatementBadge state={state} />
        </td>

        {edc.banks.map((b) => (
          <td key={b.code} className={cn(TD, amountCell, 'w-28')}>
            {b.dashboardPhoto ? (
              <span className="inline-flex items-center justify-end gap-1">
                <IndodanaPhotoMark line={line} onOpen={() => onOpenPhoto('indodana')} />
                <BankAmount filled={b.filled} total={b.total} />
              </span>
            ) : (
              <BankAmount filled={b.filled} total={b.total} />
            )}
          </td>
        ))}
        <td className={cn(TD, amountCell, 'w-32')}>
          {edc.opMeVoucher === null ? <span className="text-slate-300">–</span> : (
            <span className={edc.opMeVoucher === 0 ? 'text-slate-400' : 'text-slate-800'}>{num(edc.opMeVoucher)}</span>
          )}
        </td>
        <td className={cn(TD, amountCell, 'w-32 font-bold')}>
          {edc.hasData ? <span className="text-slate-900">{num(edc.total)}</span> : <span className="font-normal text-slate-300">–</span>}
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

/** A bank's day total (all methods); a typed 0 reads grey, a bank nobody counted a dash. */
function BankAmount({ filled, total }: { filled: boolean; total: number }) {
  if (!filled) return <span className="text-slate-300">–</span>;
  return <span className={total === 0 ? 'text-slate-400' : 'text-slate-800'}>{num(total)}</span>;
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
  const [lightbox, setLightbox] = useState<{ title: string; photos: LightboxPhoto[]; index: number } | null>(null);

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
    () =>
      rows.map((row) => {
        const edc = summariseEdc(row.edcEntries, row.opMeVoucher);
        return {
          row,
          state: deriveStatement(row, isPast),
          edc,
          indodanaMissing: banksMissingPhoto(edc, row.indodanaPhoto).length > 0,
        };
      }),
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

  // The totals row under the sheet adds up exactly what is listed.
  const totals = useMemo(
    () => ({
      banks: EDC_BANKS.map((_, i) => visible.reduce((sum, l) => sum + l.edc.banks[i].total, 0)),
      opMeVoucher: visible.reduce((sum, l) => sum + (l.edc.opMeVoucher ?? 0), 0),
      total: visible.reduce((sum, l) => sum + l.edc.total, 0),
      counted: visible.filter((l) => l.edc.hasData).length,
    }),
    [visible],
  );

  const submitted = rows.filter((r) => r.status === 'completed').length;
  const posted = lines.filter((l) => l.state === 'posted' || l.state === 'posted_after_hold').length;
  const notSubmitted = lines.filter((l) => l.state === 'not_submitted').length;
  // A submitted closing is missing evidence: no Z-Report & EDC photo, or Indodana has an amount but no dashboard photo.
  const noPhoto = lines.filter((l) => l.row.status === 'completed' && (!l.row.zReportPhoto || l.indodanaMissing)).length;
  const dayEdcTotal = lines.reduce((sum, l) => sum + l.edc.total, 0);
  const dayEdcStores = lines.filter((l) => l.edc.hasData).length;
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

  /** Opens the viewer on the clicked photo; the store's other photo is one arrow away. */
  const openPhoto = (row: StoreClosingRow, kind: PhotoKind) => {
    const photos: LightboxPhoto[] = [];
    let index = 0;
    if (row.zReportPhoto) photos.push({ url: row.zReportPhoto, label: ZREPORT_LABEL });
    if (row.indodanaPhoto) {
      if (kind === 'indodana') index = photos.length;
      photos.push({ url: row.indodanaPhoto, label: INDODANA_PHOTO_LABEL });
    }
    if (photos.length > 0) setLightbox({ title: `${row.storeNo} · ${row.storeName}`, photos, index });
  };

  return (
    <div className="min-h-full bg-slate-50">
      {lightbox && (
        <PhotoLightbox
          title={lightbox.title}
          photos={lightbox.photos}
          index={lightbox.index}
          onIndex={(i) => setLightbox((l) => (l ? { ...l, index: i } : l))}
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
              { label: 'Foto belum ada', value: String(noPhoto), sub: 'sudah submit tanpa foto Z-Report & EDC atau dashboard Indodana', warn: noPhoto > 0 },
              { label: 'Total EDC', value: rp(dayEdcTotal), sub: `${dayEdcStores} toko sudah isi rekap · termasuk ${OP_ME_VOUCHER_LABEL}` },
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
              <table className="w-full min-w-[1700px] border-separate border-spacing-0 text-left">
                <thead>
                  <tr>
                    <th className={cn(TH, 'w-11 text-center')}>No</th>
                    <th className={cn(TH, 'text-left')}>Kode</th>
                    <th className={cn(TH, 'text-left')}>Nama Toko</th>
                    <th className={cn(TH, 'text-left')}>Foto Z-Report & EDC</th>
                    <th className={cn(TH, 'text-left')}>Open Statement</th>
                    {EDC_BANKS.map((b) => (
                      <th key={b.code} className={cn(TH, 'text-right')}>{b.label}</th>
                    ))}
                    <th className={cn(TH, 'text-right')}>{OP_ME_VOUCHER_LABEL}</th>
                    <th className={cn(TH, 'text-right')}>Total</th>
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
                      onOpenPhoto={(kind) => openPhoto(l.row, kind)}
                    />
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td
                      colSpan={5}
                      className="sticky bottom-0 z-10 border-r border-t border-slate-300 bg-slate-100 px-2.5 py-2 text-xs font-semibold text-slate-600"
                    >
                      Total · {visible.length} toko{filtered ? ' (sesuai filter)' : ''} · {totals.counted} sudah isi rekap EDC
                    </td>
                    {totals.banks.map((total, i) => (
                      <td
                        key={EDC_BANKS[i].code}
                        className="sticky bottom-0 z-10 whitespace-nowrap border-r border-t border-slate-300 bg-slate-100 px-2.5 py-2 text-right text-xs font-bold tabular-nums text-slate-700"
                      >
                        {num(total)}
                      </td>
                    ))}
                    <td className="sticky bottom-0 z-10 whitespace-nowrap border-r border-t border-slate-300 bg-slate-100 px-2.5 py-2 text-right text-xs font-bold tabular-nums text-slate-700">
                      {num(totals.opMeVoucher)}
                    </td>
                    <td className="sticky bottom-0 z-10 whitespace-nowrap border-r border-t border-slate-300 bg-emerald-100 px-2.5 py-2 text-right text-xs font-bold tabular-nums text-emerald-900">
                      {num(totals.total)}
                    </td>
                    <td colSpan={3} className="sticky bottom-0 z-10 border-t border-slate-300 bg-slate-100" />
                  </tr>
                </tfoot>
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
                Kolom bank = total QRIS + Debit + Credit dari rekap EDC toko (Rp); buka barisnya untuk melihat per metode.
                Tanda <Camera className="inline h-3 w-3 text-emerald-600" /> di Indodana = foto dashboard tersedia,{' '}
                <AlertTriangle className="inline h-3 w-3 text-amber-500" /> = ada transaksi Indodana tapi foto dashboard
                belum diupload. Closing yang dibuat sebelum rekap per bank hanya punya checklist, jadi kolom nominalnya kosong (–).
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
