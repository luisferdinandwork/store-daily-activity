'use client';
// app/finance/petty-cash/report/page.tsx
//
// Finance · Petty Cash Report
//
// Laid out like the spreadsheet Finance works from: one row per store with
// what it used this month and the bank account its PIC 1 gave for the refill
// (filled in on the refill request — see RefillBankForm on the employee page).
//
//   • "All Stores"      — a single flat sheet.
//   • "By Store Code"   — subtotal per store code (FF / FS / FO / ODD / SS …),
//                         then the same sheet grouped under each code.
//
// The Refill column tracks each store's refill request and is where Finance
// records that it has refilled the store: "Verifikasi" on an OPS-approved
// request (one by one, or tick several). Until it is verified PIC 1 can't
// confirm receipt on the employee page. "Batal" takes it back while PIC 1
// hasn't uploaded any proof photo yet.
//
// "Download Excel" exports the same data (and the current code filter) as .xlsx.

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertTriangle,
  CheckCheck,
  CircleCheck,
  Download,
  FileSpreadsheet,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  Undo2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { STORE_STATUS_BADGE, STORE_STATUS_LABEL } from '@/lib/store-status';
import {
  REFILL_STATE_LABEL,
  groupByStoreCode,
  hasBankDetails,
  reportMonthLabel,
  type PettyCashReportRow,
  type RefillState,
  type StoreCodeGroup,
} from '@/lib/petty-cash-report';
import {
  CopyButton,
  MonthNavigator,
  PettyCashTabs,
  SHEET_ROW_HEAD as ROW_HEAD,
  SHEET_TD as TD,
  SHEET_TH as TH,
  currentMonth,
  num,
  rp,
} from '@/components/finance/petty-cash/shared';

type View = 'all' | 'code';

/** Column count of the sheet — group headers span it. */
const COLS = 12;

const REFILL_CHIP: Record<RefillState, string> = {
  pending: 'bg-slate-100 text-slate-600 ring-slate-200',
  awaiting_finance: 'bg-amber-50 text-amber-800 ring-amber-200',
  verified: 'bg-sky-50 text-sky-700 ring-sky-200',
  received: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  rejected: 'bg-rose-50 text-rose-700 ring-rose-200',
};

const needsVerify = (r: PettyCashReportRow) => r.refill?.state === 'awaiting_finance';

const fmtWhen = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('id-ID', {
        timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
      })
    : '';

// ─── Excel download ──────────────────────────────────────────────────────────

async function downloadReport(params: { month: string; code: string | null; onlyUsed: boolean }) {
  const qs = new URLSearchParams({ month: params.month });
  if (params.code) qs.set('code', params.code);
  if (params.onlyUsed) qs.set('onlyUsed', '1');

  const res = await fetch(`/api/finance/petty-cash/report/export?${qs}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? `HTTP ${res.status}`);
  }

  const blob = await res.blob();
  const filename =
    res.headers.get('content-disposition')?.match(/filename="(.+)"/)?.[1] ??
    `petty-cash-report_${params.month}.xlsx`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Sheet cells ─────────────────────────────────────────────────────────────


function Amount({ value, bold }: { value: number; bold?: boolean }) {
  return (
    <span className={cn('tabular-nums', value === 0 ? 'text-slate-300' : 'text-slate-900', bold && 'font-semibold')}>
      {value === 0 ? '–' : num(value)}
    </span>
  );
}

function Missing({ children = 'Belum diisi' }: { children?: string }) {
  return <span className="text-xs italic text-amber-700">{children}</span>;
}

function RefillCell({
  row,
  busy,
  onVerify,
  onUndo,
}: {
  row: PettyCashReportRow;
  busy: boolean;
  onVerify: () => void;
  onUndo: () => void;
}) {
  const refill = row.refill;
  if (!refill) return <span className="text-slate-300">–</span>;

  const verifiedNote = refill.verifiedAt
    ? `Diverifikasi ${refill.verifiedByName ?? 'Finance'} · ${fmtWhen(refill.verifiedAt)}`
    : null;
  const receivedNote = refill.state === 'received' ? `Diterima toko ${fmtWhen(refill.receivedAt)}` : null;
  const title = [verifiedNote, receivedNote].filter(Boolean).join(' — ') || undefined;

  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <span
        title={title}
        className={cn(
          'inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset',
          REFILL_CHIP[refill.state],
        )}
      >
        {(refill.state === 'verified' || refill.state === 'received') && <ShieldCheck className="h-3 w-3" />}
        {REFILL_STATE_LABEL[refill.state]}
      </span>

      {refill.state === 'awaiting_finance' && (
        <button
          type="button"
          onClick={onVerify}
          disabled={busy}
          title="Tandai toko ini sudah di-refill — PIC 1 baru bisa konfirmasi penerimaan setelah ini."
          className="inline-flex h-6 items-center gap-1 rounded bg-emerald-600 px-2 text-[11px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <CircleCheck className="h-3 w-3" />}
          Verifikasi
        </button>
      )}

      {refill.state === 'verified' && refill.proofCount === 0 && (
        <button
          type="button"
          onClick={onUndo}
          disabled={busy}
          title="Batalkan verifikasi (masih bisa selama PIC 1 belum mengunggah foto bukti)."
          className="inline-flex h-6 items-center gap-1 rounded border border-slate-300 bg-white px-1.5 text-[11px] font-semibold text-slate-500 hover:bg-slate-50 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Undo2 className="h-3 w-3" />}
          Batal
        </button>
      )}

      {refill.state === 'verified' && refill.proofCount > 0 && (
        <span className="text-[11px] text-slate-500">foto {refill.proofCount}/2</span>
      )}
    </span>
  );
}

function StoreLine({
  row,
  index,
  selected,
  busy,
  onSelect,
  onVerify,
  onUndo,
}: {
  row: PettyCashReportRow;
  index: number;
  selected: boolean;
  busy: boolean;
  onSelect: () => void;
  onVerify: () => void;
  onUndo: () => void;
}) {
  const waiting = needsVerify(row);

  return (
    <tr className={cn('text-[13px]', selected ? 'bg-emerald-50' : 'bg-white hover:bg-emerald-50/40')}>
      <td className={cn(TD, 'w-9 text-center')}>
        {waiting && (
          <input
            type="checkbox"
            checked={selected}
            onChange={onSelect}
            aria-label={`Pilih ${row.storeName}`}
            className="h-3.5 w-3.5 rounded border-slate-300 accent-emerald-600"
          />
        )}
      </td>
      <td className={cn(ROW_HEAD, 'w-11')}>{index}</td>
      <td className={cn(TD, 'w-24 whitespace-nowrap font-mono text-xs font-semibold text-slate-600')}>{row.storeNo}</td>
      <td className={cn(TD, 'min-w-56 font-medium text-slate-900')}>
        {row.storeName}
        {row.storeStatus !== 'active' && (
          <span
            className={cn(
              'ml-2 rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset',
              STORE_STATUS_BADGE[row.storeStatus],
            )}
          >
            {STORE_STATUS_LABEL[row.storeStatus]}
          </span>
        )}
      </td>
      <td className={cn(TD, 'w-40 whitespace-nowrap font-mono text-[11px] text-slate-500')}>
        {row.deptCode ?? <span className="text-slate-300">–</span>}
      </td>
      <td className={cn(TD, 'w-36 text-right')}>
        <Amount value={row.totalUsed} />
      </td>
      <td className={cn(TD, 'min-w-44', !row.accountNumber && 'bg-amber-50')}>
        {row.accountNumber ? (
          <span className="flex items-center gap-1">
            <span className="font-mono text-xs tabular-nums text-slate-800">{row.accountNumber}</span>
            <CopyButton value={row.accountNumber} label="Copy account number" />
          </span>
        ) : (
          <Missing />
        )}
      </td>
      <td className={cn(TD, 'min-w-36 text-slate-700')}>{row.pic1Name ?? <span className="text-slate-300">–</span>}</td>
      <td className={cn(TD, 'w-32 whitespace-nowrap', !row.bankName && 'bg-amber-50')}>
        {row.bankName ?? <Missing>–</Missing>}
      </td>
      <td className={cn(TD, 'min-w-44 uppercase', !row.accountHolderName && 'bg-amber-50')}>
        {row.accountHolderName ?? <Missing>–</Missing>}
      </td>
      <td className={cn(TD, 'min-w-52', waiting && 'bg-amber-50/60')}>
        <RefillCell row={row} busy={busy} onVerify={onVerify} onUndo={onUndo} />
      </td>
    </tr>
  );
}

function TotalLine({ label, value, tone }: { label: string; value: number; tone: 'sub' | 'grand' }) {
  // Row borders don't render in a border-separate table, so the rule above the
  // total goes on its cells.
  const cls = tone === 'grand'
    ? 'bg-emerald-50 text-slate-900 [&>td]:border-t-2 [&>td]:border-t-slate-400'
    : 'bg-slate-50 text-slate-700 [&>td]:border-t [&>td]:border-t-slate-300';
  return (
    <tr className={cn('text-[13px] font-semibold', cls)}>
      <td className={ROW_HEAD} />
      <td className={ROW_HEAD} />
      <td className={cn(TD, 'border-slate-300')} />
      <td className={cn(TD, 'border-slate-300 text-right text-xs uppercase tracking-wide')}>{label}</td>
      <td className={cn(TD, 'border-slate-300')} />
      <td className={cn(TD, 'border-slate-300 text-right tabular-nums')}>{num(value)}</td>
      <td colSpan={COLS - 6} className={cn(TD, 'border-slate-300')} />
    </tr>
  );
}

function GroupHeaderLine({ group }: { group: StoreCodeGroup }) {
  return (
    <tr className="bg-emerald-600 text-white">
      <td colSpan={COLS} className="border-b border-emerald-700 px-3 py-1.5 text-[13px] font-semibold">
        {group.display}
        {group.brand && group.brand !== group.display && (
          <span className="ml-2 font-normal text-emerald-100">{group.brand}</span>
        )}
        <span className="ml-3 text-xs font-normal text-emerald-100">
          {group.storeCount} store{group.storeCount === 1 ? '' : 's'}
        </span>
      </td>
    </tr>
  );
}

// ─── Store-code summary ──────────────────────────────────────────────────────

function CodeSummary({
  groups,
  activeCode,
  onPick,
}: {
  groups: StoreCodeGroup[];
  activeCode: string | null;
  onPick: (code: string | null) => void;
}) {
  const totalUsed = groups.reduce((s, g) => s + g.totalUsed, 0);
  const totalStores = groups.reduce((s, g) => s + g.storeCount, 0);
  const totalWithBank = groups.reduce((s, g) => s + g.withBankCount, 0);
  const totalAwaiting = groups.reduce((s, g) => s + g.awaitingVerifyCount, 0);

  return (
    <div className="overflow-x-auto rounded-md border border-slate-300 bg-white">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr>
            {['Code', 'Brand', 'Stores', 'Total Terpakai (Rp)', 'Rekening Terisi', 'Perlu Verifikasi'].map((h, i) => (
              <th
                key={h}
                className={cn(
                  'border border-slate-300 bg-slate-100 px-2.5 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-600',
                  i >= 2 ? 'text-right' : 'text-left',
                )}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <tr
              key={g.code}
              onClick={() => onPick(activeCode === g.code ? null : g.code)}
              className={cn(
                'cursor-pointer',
                activeCode === g.code ? 'bg-emerald-50' : 'bg-white hover:bg-slate-50',
              )}
            >
              <td className={cn(TD, 'font-mono text-xs font-bold text-emerald-700')}>{g.display}</td>
              <td className={cn(TD, 'text-slate-700')}>{g.brand ?? <span className="text-slate-300">–</span>}</td>
              <td className={cn(TD, 'text-right tabular-nums')}>{g.storeCount}</td>
              <td className={cn(TD, 'text-right')}><Amount value={g.totalUsed} /></td>
              <td className={cn(TD, 'text-right tabular-nums', g.withBankCount < g.storeCount ? 'bg-amber-50 text-amber-800' : 'text-slate-700')}>
                {g.withBankCount} / {g.storeCount}
              </td>
              <td className={cn(TD, 'text-right tabular-nums', g.awaitingVerifyCount > 0 ? 'bg-amber-50 font-semibold text-amber-800' : 'text-slate-300')}>
                {g.awaitingVerifyCount > 0 ? g.awaitingVerifyCount : '–'}
              </td>
            </tr>
          ))}
          <tr className="border-y-2 border-slate-400 bg-emerald-50 font-semibold text-slate-900">
            <td className={TD} />
            <td className={cn(TD, 'text-right text-xs uppercase tracking-wide')}>Total</td>
            <td className={cn(TD, 'text-right tabular-nums')}>{totalStores}</td>
            <td className={cn(TD, 'text-right tabular-nums')}>{num(totalUsed)}</td>
            <td className={cn(TD, 'text-right tabular-nums')}>{totalWithBank} / {totalStores}</td>
            <td className={cn(TD, 'text-right tabular-nums')}>{totalAwaiting}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function FinancePettyCashReportPage() {
  const [month, setMonth] = useState(currentMonth);
  const [rows, setRows] = useState<PettyCashReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [view, setView] = useState<View>('all');
  const [code, setCode] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [onlyUsed, setOnlyUsed] = useState(false);
  const [onlyAwaiting, setOnlyAwaiting] = useState(false);

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [busyIds, setBusyIds] = useState<Set<number>>(new Set());

  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    let stale = false;
    setLoading(true);
    setError(null);

    fetch(`/api/finance/petty-cash/report?month=${month}`, { cache: 'no-store' })
      .then((res) => res.json())
      .then((body) => {
        if (stale) return;
        if (body.success) {
          const data: PettyCashReportRow[] = body.data;
          setRows(data);
          // Keep ticks only for refills that still need verifying after a reload.
          const open = new Set(data.filter(needsVerify).map((r) => r.refill!.id));
          setSelected((prev) => new Set([...prev].filter((id) => open.has(id))));
        } else {
          setError(body.error ?? 'Failed to load the report.');
        }
      })
      .catch(() => { if (!stale) setError('Network error.'); })
      .finally(() => { if (!stale) setLoading(false); });

    return () => { stale = true; };
  }, [month, reloadKey]);

  // Chips + counts come from every store, so they don't shrink as you search.
  const allGroups = useMemo(() => groupByStoreCode(rows), [rows]);

  // Search + usage filters, before the code filter — the by-code summary
  // still lists every code so you can switch between them.
  const matching = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (onlyUsed && r.totalUsed === 0) return false;
      if (onlyAwaiting && !needsVerify(r)) return false;
      if (!q) return true;
      return [r.storeNo, r.storeName, r.deptCode, r.pic1Name, r.bankName, r.accountNumber, r.accountHolderName]
        .some((v) => v?.toLowerCase().includes(q));
    });
  }, [rows, onlyUsed, onlyAwaiting, search]);

  const summaryGroups = useMemo(() => groupByStoreCode(matching), [matching]);
  const visibleRows = useMemo(
    () => (code ? matching.filter((r) => r.code === code) : matching),
    [matching, code],
  );
  const visibleGroups = useMemo(() => groupByStoreCode(visibleRows), [visibleRows]);

  const totalUsed = visibleRows.reduce((s, r) => s + r.totalUsed, 0);
  const withUsage = visibleRows.filter((r) => r.totalUsed > 0).length;
  const missingBank = visibleRows.filter((r) => !hasBankDetails(r)).length;
  const awaiting = visibleRows.filter(needsVerify).length;

  const filtered = Boolean(code || search || onlyUsed || onlyAwaiting);

  const selectableIds = visibleRows.filter(needsVerify).map((r) => r.refill!.id);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));

  // ── Actions ──

  const toggleSelected = (id: number) => {
    setConfirmBulk(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setConfirmBulk(false);
    setSelected(allSelected ? new Set() : new Set(selectableIds));
  };

  async function run(ids: number[], action: 'verify' | 'unverify', label: string) {
    setBusyIds((prev) => new Set([...prev, ...ids]));
    try {
      const res = await fetch('/api/finance/petty-cash/refill-requests/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, action }),
      });
      const body = await res.json();
      if (!body.success) {
        toast.error(body.error ?? 'Gagal memproses.');
      } else if (body.changed === 0) {
        toast.error(
          action === 'verify'
            ? 'Tidak ada yang bisa diverifikasi — status Refill sudah berubah.'
            : 'Tidak bisa dibatalkan — PIC 1 sudah mengunggah foto bukti.',
        );
      } else {
        toast.success(
          action === 'verify'
            ? `${label} diverifikasi — PIC 1 sekarang bisa mengonfirmasi penerimaan.`
            : `Verifikasi ${label} dibatalkan.`,
        );
        setSelected((prev) => new Set([...prev].filter((id) => !ids.includes(id))));
      }
      setReloadKey((k) => k + 1);
    } catch {
      toast.error('Network error.');
    } finally {
      setBusyIds((prev) => new Set([...prev].filter((id) => !ids.includes(id))));
      setConfirmBulk(false);
    }
  }

  async function handleDownload() {
    setDownloading(true);
    setDownloadError(null);
    try {
      await downloadReport({ month, code, onlyUsed });
    } catch (e) {
      setDownloadError(e instanceof Error ? e.message : 'Download failed.');
    } finally {
      setDownloading(false);
    }
  }

  const renderLine = (row: PettyCashReportRow, index: number) => (
    <StoreLine
      key={row.storeId}
      row={row}
      index={index}
      selected={row.refill != null && selected.has(row.refill.id)}
      busy={row.refill != null && busyIds.has(row.refill.id)}
      onSelect={() => row.refill && toggleSelected(row.refill.id)}
      onVerify={() => row.refill && void run([row.refill.id], 'verify', row.storeName)}
      onUndo={() => row.refill && void run([row.refill.id], 'unverify', row.storeName)}
    />
  );

  return (
    <div className="min-h-full bg-slate-50">
      {/* Header */}
      <div className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-[1400px] px-6 pt-4 lg:px-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-600">
                Finance · Petty Cash
              </p>
              <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-slate-900">Petty Cash Report</h1>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <MonthNavigator month={month} onChange={setMonth} />

              <button
                type="button"
                onClick={() => setReloadKey((k) => k + 1)}
                disabled={loading}
                className="flex h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
              >
                <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
                Refresh
              </button>

              <button
                type="button"
                onClick={handleDownload}
                disabled={loading || downloading || rows.length === 0}
                className="flex h-9 items-center gap-2 rounded-md bg-emerald-600 px-3.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                {downloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                Download Excel{code ? ` (${allGroups.find((g) => g.code === code)?.display ?? code})` : ''}
              </button>
            </div>
          </div>

          <div className="mt-3">
            <PettyCashTabs />
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-[1400px] space-y-4 px-6 py-5 lg:px-8">
        {/* Key numbers — a plain strip, not cards */}
        {!loading && !error && (
          <dl className="grid grid-cols-2 divide-x divide-slate-200 overflow-hidden rounded-md border border-slate-300 bg-white sm:grid-cols-5">
            {[
              { label: `Total used · ${reportMonthLabel(month)}`, value: rp(totalUsed) },
              { label: 'Stores', value: String(visibleRows.length) },
              { label: 'With usage', value: String(withUsage) },
              { label: 'No bank details yet', value: String(missingBank), warn: missingBank > 0 },
              { label: 'Refill perlu verifikasi', value: String(awaiting), warn: awaiting > 0 },
            ].map(({ label, value, warn }) => (
              <div key={label} className="px-4 py-3">
                <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
                <dd className={cn('mt-0.5 text-lg font-bold tabular-nums', warn ? 'text-amber-600' : 'text-slate-900')}>
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        )}

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <div className="inline-flex rounded-md border border-slate-300 bg-white p-0.5 text-xs font-semibold">
            {([
              ['all', 'All Stores'],
              ['code', 'By Store Code'],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setView(key)}
                className={cn(
                  'rounded px-3 py-1.5 transition-colors',
                  view === key ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:bg-slate-50',
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by store code">
            <button
              type="button"
              onClick={() => setCode(null)}
              className={cn(
                'rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors',
                code === null
                  ? 'border-emerald-600 bg-emerald-50 text-emerald-700'
                  : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50',
              )}
            >
              All <span className="ml-0.5 font-normal text-slate-400">{rows.length}</span>
            </button>
            {allGroups.map((g) => (
              <button
                key={g.code}
                type="button"
                onClick={() => setCode(code === g.code ? null : g.code)}
                title={g.brand ?? undefined}
                className={cn(
                  'rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors',
                  code === g.code
                    ? 'border-emerald-600 bg-emerald-50 text-emerald-700'
                    : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50',
                )}
              >
                {g.display} <span className="ml-0.5 font-normal text-slate-400">{g.storeCount}</span>
              </button>
            ))}
          </div>

          <div className="relative min-w-[200px] max-w-xs flex-1">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search store, PIC, bank, account…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 w-full rounded-md border border-slate-300 bg-white pl-9 pr-3 text-sm placeholder-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
            />
          </div>

          <label className="flex cursor-pointer select-none items-center gap-2 text-xs font-medium text-slate-600">
            <input
              type="checkbox"
              checked={onlyUsed}
              onChange={(e) => setOnlyUsed(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-slate-300 accent-emerald-600"
            />
            Only stores with usage
          </label>

          <label className="flex cursor-pointer select-none items-center gap-2 text-xs font-medium text-slate-600">
            <input
              type="checkbox"
              checked={onlyAwaiting}
              onChange={(e) => setOnlyAwaiting(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-slate-300 accent-emerald-600"
            />
            Only refills to verify
          </label>

          {filtered && (
            <button
              type="button"
              onClick={() => { setCode(null); setSearch(''); setOnlyUsed(false); setOnlyAwaiting(false); }}
              className="text-xs font-semibold text-slate-500 underline hover:text-slate-700"
            >
              Clear
            </button>
          )}
        </div>

        {(error || downloadError) && (
          <div className="flex items-center gap-3 rounded-md border border-rose-200 bg-rose-50 px-4 py-3">
            <AlertTriangle className="h-4 w-4 shrink-0 text-rose-500" />
            <p className="text-sm font-medium text-rose-700">{error ?? downloadError}</p>
          </div>
        )}

        {/* Bulk verify bar */}
        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-3 rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2.5 text-sm">
            <CheckCheck className="h-4 w-4 text-emerald-700" />
            <span className="font-semibold text-emerald-900">{selected.size} Refill dipilih</span>
            <div className="ml-auto flex items-center gap-2">
              {confirmBulk ? (
                <>
                  <span className="text-xs font-medium text-emerald-900">
                    Yakin {selected.size} toko sudah di-refill?
                  </span>
                  <button
                    type="button"
                    onClick={() => void run([...selected], 'verify', `${selected.size} Refill`)}
                    disabled={busyIds.size > 0}
                    className="flex h-8 items-center gap-1.5 rounded-md bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                  >
                    {busyIds.size > 0 && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    Ya, verifikasi
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmBulk(false)}
                    className="h-8 rounded-md border border-emerald-300 bg-white px-3 text-xs font-semibold text-emerald-800 hover:bg-emerald-100"
                  >
                    Batal
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setSelected(new Set())}
                    className="text-xs font-semibold text-emerald-800 underline"
                  >
                    Batal pilih
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmBulk(true)}
                    className="flex h-8 items-center gap-1.5 rounded-md bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-700"
                  >
                    <ShieldCheck className="h-3.5 w-3.5" />
                    Verifikasi {selected.size}
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* Sheet */}
        {loading ? (
          <div className="overflow-hidden rounded-md border border-slate-300 bg-white">
            <div className="h-9 animate-pulse bg-slate-100" />
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-8 animate-pulse border-t border-slate-100 bg-white even:bg-slate-50/60" />
            ))}
          </div>
        ) : visibleRows.length === 0 ? (
          <div className="rounded-md border border-dashed border-slate-300 bg-white py-16 text-center">
            <FileSpreadsheet className="mx-auto mb-3 h-9 w-9 text-slate-300" />
            <p className="text-sm font-semibold text-slate-600">
              {filtered ? 'No stores match your filter.' : 'No stores found.'}
            </p>
          </div>
        ) : (
          <>
            {view === 'code' && (
              <CodeSummary groups={summaryGroups} activeCode={code} onPick={setCode} />
            )}

            <div className="max-h-[68vh] overflow-auto rounded-md border border-slate-300 bg-white">
              <table className="w-full min-w-[1400px] border-separate border-spacing-0 text-left">
                <thead>
                  <tr>
                    <th className={cn(TH, 'w-9 text-center')}>
                      <input
                        type="checkbox"
                        checked={allSelected}
                        disabled={selectableIds.length === 0}
                        onChange={toggleAll}
                        title="Pilih semua Refill yang perlu diverifikasi"
                        aria-label="Pilih semua Refill yang perlu diverifikasi"
                        className="h-3.5 w-3.5 rounded border-slate-300 accent-emerald-600 disabled:opacity-40"
                      />
                    </th>
                    <th className={cn(TH, 'w-11 text-center')}>No</th>
                    <th className={cn(TH, 'text-left')}>Kode</th>
                    <th className={cn(TH, 'text-left')}>Nama Toko</th>
                    <th className={cn(TH, 'text-left')}>Dept Code</th>
                    <th className={cn(TH, 'text-right')}>Total Terpakai (Rp)</th>
                    <th className={cn(TH, 'text-left')}>No. Rekening</th>
                    <th className={cn(TH, 'text-left')}>PIC 1</th>
                    <th className={cn(TH, 'text-left')}>Bank</th>
                    <th className={cn(TH, 'text-left')}>Atas Nama</th>
                    <th className={cn(TH, 'text-left')}>Refill</th>
                  </tr>
                </thead>

                <tbody>
                  {view === 'all'
                    ? visibleRows.map((row, i) => renderLine(row, i + 1))
                    : visibleGroups.map((g) => (
                        <GroupBlock key={g.code} group={g} renderLine={renderLine} />
                      ))}
                  <TotalLine label="Total" value={totalUsed} tone="grand" />
                </tbody>
              </table>
            </div>

            <p className="text-[11px] text-slate-500">
              Total Terpakai = completed petty cash spend in {reportMonthLabel(month)}. Rekening comes from the
              refill request PIC 1 submitted (the one being paid, else their latest); amber cells mean none has been
              filed yet. Refill: <span className="font-semibold">Perlu verifikasi</span> = OPS approved, waiting for
              Finance to send the cash — verify it to let PIC 1 confirm receipt on their app;{' '}
              <span className="font-semibold">Diterima toko</span> = PIC 1 uploaded both proof photos.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function GroupBlock({
  group,
  renderLine,
}: {
  group: StoreCodeGroup;
  renderLine: (row: PettyCashReportRow, index: number) => React.ReactNode;
}) {
  return (
    <>
      <GroupHeaderLine group={group} />
      {group.rows.map((row, i) => renderLine(row, i + 1))}
      <TotalLine label={`Subtotal ${group.display}`} value={group.totalUsed} tone="sub" />
    </>
  );
}
