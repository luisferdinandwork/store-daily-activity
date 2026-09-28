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
// "Download Excel" exports the same data (and the current code filter) as .xlsx.

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Download,
  FileSpreadsheet,
  Loader2,
  RefreshCw,
  Search,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  groupByStoreCode,
  hasBankDetails,
  reportMonthLabel,
  type PettyCashReportRow,
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

function StoreLine({ row, index }: { row: PettyCashReportRow; index: number }) {
  return (
    <tr className="bg-white text-[13px] hover:bg-emerald-50/40">
      <td className={cn(ROW_HEAD, 'w-11')}>{index}</td>
      <td className={cn(TD, 'w-24 whitespace-nowrap font-mono text-xs font-semibold text-slate-600')}>{row.storeNo}</td>
      <td className={cn(TD, 'min-w-56 font-medium text-slate-900')}>{row.storeName}</td>
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
      <td className={cn(TD, 'border-slate-300')} />
      <td className={cn(TD, 'border-slate-300 text-right text-xs uppercase tracking-wide')}>{label}</td>
      <td className={cn(TD, 'border-slate-300 text-right tabular-nums')}>{num(value)}</td>
      <td colSpan={4} className={cn(TD, 'border-slate-300')} />
    </tr>
  );
}

function GroupHeaderLine({ group }: { group: StoreCodeGroup }) {
  return (
    <tr className="bg-emerald-600 text-white">
      <td colSpan={8} className="border-b border-emerald-700 px-3 py-1.5 text-[13px] font-semibold">
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

  return (
    <div className="overflow-x-auto rounded-md border border-slate-300 bg-white">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr>
            {['Code', 'Brand', 'Stores', 'Total Terpakai (Rp)', 'Rekening Terisi'].map((h, i) => (
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
            </tr>
          ))}
          <tr className="border-y-2 border-slate-400 bg-emerald-50 font-semibold text-slate-900">
            <td className={TD} />
            <td className={cn(TD, 'text-right text-xs uppercase tracking-wide')}>Total</td>
            <td className={cn(TD, 'text-right tabular-nums')}>{totalStores}</td>
            <td className={cn(TD, 'text-right tabular-nums')}>{num(totalUsed)}</td>
            <td className={cn(TD, 'text-right tabular-nums')}>{totalWithBank} / {totalStores}</td>
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
        if (body.success) setRows(body.data);
        else setError(body.error ?? 'Failed to load the report.');
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
      if (!q) return true;
      return [r.storeNo, r.storeName, r.pic1Name, r.bankName, r.accountNumber, r.accountHolderName]
        .some((v) => v?.toLowerCase().includes(q));
    });
  }, [rows, onlyUsed, search]);

  const summaryGroups = useMemo(() => groupByStoreCode(matching), [matching]);
  const visibleRows = useMemo(
    () => (code ? matching.filter((r) => r.code === code) : matching),
    [matching, code],
  );
  const visibleGroups = useMemo(() => groupByStoreCode(visibleRows), [visibleRows]);

  const totalUsed = visibleRows.reduce((s, r) => s + r.totalUsed, 0);
  const withUsage = visibleRows.filter((r) => r.totalUsed > 0).length;
  const missingBank = visibleRows.filter((r) => !hasBankDetails(r)).length;

  const filtered = Boolean(code || search || onlyUsed);

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
          <dl className="grid grid-cols-2 divide-x divide-slate-200 overflow-hidden rounded-md border border-slate-300 bg-white sm:grid-cols-4">
            {[
              { label: `Total used · ${reportMonthLabel(month)}`, value: rp(totalUsed) },
              { label: 'Stores', value: String(visibleRows.length) },
              { label: 'With usage', value: String(withUsage) },
              { label: 'No bank details yet', value: String(missingBank), warn: missingBank > 0 },
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

          {filtered && (
            <button
              type="button"
              onClick={() => { setCode(null); setSearch(''); setOnlyUsed(false); }}
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
              <table className="w-full min-w-[980px] border-separate border-spacing-0 text-left">
                <thead>
                  <tr>
                    <th className={cn(TH, 'w-11 text-center')}>No</th>
                    <th className={cn(TH, 'text-left')}>Kode</th>
                    <th className={cn(TH, 'text-left')}>Nama Toko</th>
                    <th className={cn(TH, 'text-right')}>Total Terpakai (Rp)</th>
                    <th className={cn(TH, 'text-left')}>No. Rekening</th>
                    <th className={cn(TH, 'text-left')}>PIC 1</th>
                    <th className={cn(TH, 'text-left')}>Bank</th>
                    <th className={cn(TH, 'text-left')}>Atas Nama</th>
                  </tr>
                </thead>

                <tbody>
                  {view === 'all'
                    ? visibleRows.map((row, i) => <StoreLine key={row.storeId} row={row} index={i + 1} />)
                    : visibleGroups.map((g) => (
                        <GroupBlock key={g.code} group={g} />
                      ))}
                  <TotalLine label="Total" value={totalUsed} tone="grand" />
                </tbody>
              </table>
            </div>

            <p className="text-[11px] text-slate-500">
              Total Terpakai = completed petty cash spend in {reportMonthLabel(month)}. Rekening comes from the
              latest refill request PIC 1 submitted; amber cells mean none has been filed yet.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function GroupBlock({ group }: { group: StoreCodeGroup }) {
  return (
    <>
      <GroupHeaderLine group={group} />
      {group.rows.map((row, i) => (
        <StoreLine key={row.storeId} row={row} index={i + 1} />
      ))}
      <TotalLine label={`Subtotal ${group.display}`} value={group.totalUsed} tone="sub" />
    </>
  );
}
