'use client';
// app/finance/setoran/report/page.tsx
//
// Finance · Setoran Report (monthly)
//
// One row per store for the month, laid out like the Petty Cash Report: how
// many work days it had, how many it deposited / skipped / missed, what it
// received and deposited, the balance still owed and how many submissions
// Finance hasn't verified yet.
//
//   • "All Stores"    — a single flat sheet.
//   • "By Store Code" — subtotal per store code, then the sheet grouped by code.
//
// "Download Excel" exports the same data (and the current code filter) as .xlsx.

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertTriangle,
  Download,
  FileSpreadsheet,
  Loader2,
  RefreshCw,
  Search,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { reportMonthLabel } from '@/lib/petty-cash-report';
import {
  fmtDateShort,
  groupRowsByCode,
  sumMonth,
  type CodeGroup,
  type SetoranMonthRow,
} from '@/lib/setoran-review';
import {
  MonthNavigator,
  SHEET_ROW_HEAD as ROW_HEAD,
  SHEET_TD as TD,
  SHEET_TH as TH,
  currentMonth,
  num,
  rp,
} from '@/components/finance/petty-cash/shared';
import {
  CodeChips,
  GroupHeaderRow,
  KpiStrip,
  SetoranTabs,
  ViewToggle,
  downloadXlsx,
} from '@/components/finance/setoran/shared';

type View = 'all' | 'code';

const COLS = 12;

const hasIssue = (r: SetoranMonthRow) => r.missedDays > 0 || r.unverified > 0;

// ─── Cells ───────────────────────────────────────────────────────────────────

function Amount({ value, tone }: { value: number; tone?: 'teal' | 'bold' }) {
  if (value === 0) return <span className="tabular-nums text-slate-300">–</span>;
  return (
    <span className={cn('tabular-nums', tone === 'teal' ? 'text-teal-700' : 'text-slate-900', tone === 'bold' && 'font-semibold')}>
      {num(value)}
    </span>
  );
}

function Count({ value, tone }: { value: number; tone?: 'rose' | 'amber' }) {
  if (value === 0) return <span className="tabular-nums text-slate-300">–</span>;
  return (
    <span
      className={cn(
        'tabular-nums',
        tone === 'rose' && 'rounded bg-rose-50 px-1.5 py-0.5 font-semibold text-rose-700 ring-1 ring-inset ring-rose-200',
        tone === 'amber' && 'rounded bg-amber-50 px-1.5 py-0.5 font-semibold text-amber-800 ring-1 ring-inset ring-amber-200',
        !tone && 'text-slate-900',
      )}
    >
      {value}
    </span>
  );
}

function StoreLine({ row, index }: { row: SetoranMonthRow; index: number }) {
  return (
    <tr className="bg-white text-[13px] hover:bg-emerald-50/40">
      <td className={cn(ROW_HEAD, 'w-11')}>{index}</td>
      <td className={cn(TD, 'w-24 whitespace-nowrap font-mono text-xs font-semibold text-slate-600')}>{row.storeNo}</td>
      <td className={cn(TD, 'min-w-56')}>
        <p className="font-medium text-slate-900">{row.storeName}</p>
        <p className="text-[11px] text-slate-500">{row.areaName}</p>
      </td>
      <td className={cn(TD, 'w-20 text-center')}><Count value={row.workDays} /></td>
      <td className={cn(TD, 'w-20 text-center')}><Count value={row.depositDays} /></td>
      <td className={cn(TD, 'w-24 text-center')}><Count value={row.noDepositDays} /></td>
      <td className={cn(TD, 'w-24 text-center')}><Count value={row.missedDays} tone="rose" /></td>
      <td className={cn(TD, 'w-36 text-right')}><Amount value={row.totalReceived} /></td>
      <td className={cn(TD, 'w-36 text-right')}><Amount value={row.totalStored} tone="bold" /></td>
      <td className={cn(TD, 'w-36 text-right')}><Amount value={row.closingUnpaid} tone="teal" /></td>
      <td className={cn(TD, 'w-28 text-center')}><Count value={row.unverified} tone="amber" /></td>
      <td className={cn(TD, 'w-28 whitespace-nowrap text-center text-xs text-slate-600')}>
        {row.lastSubmittedDate ? fmtDateShort(row.lastSubmittedDate) : <span className="text-slate-300">–</span>}
      </td>
    </tr>
  );
}

function TotalLine({ label, rows, tone }: { label: string; rows: SetoranMonthRow[]; tone: 'sub' | 'grand' }) {
  const t = sumMonth(rows);
  // Row borders don't render in a border-separate table, so the rule above the
  // total goes on its cells.
  const cls = tone === 'grand'
    ? 'bg-emerald-50 text-slate-900 [&>td]:border-t-2 [&>td]:border-t-slate-400'
    : 'bg-slate-50 text-slate-700 [&>td]:border-t [&>td]:border-t-slate-300';
  const count = cn(TD, 'border-slate-300 text-center tabular-nums');
  const money = cn(TD, 'border-slate-300 text-right tabular-nums');

  return (
    <tr className={cn('text-[13px] font-semibold', cls)}>
      <td colSpan={3} className={cn(TD, 'border-slate-300 text-right text-xs uppercase tracking-wide')}>{label}</td>
      <td className={count}>{t.workDays}</td>
      <td className={count}>{t.depositDays}</td>
      <td className={count}>{t.noDepositDays}</td>
      <td className={count}>{t.missedDays}</td>
      <td className={money}>{num(t.totalReceived)}</td>
      <td className={money}>{num(t.totalStored)}</td>
      <td className={money}>{num(t.closingUnpaid)}</td>
      <td className={count}>{t.unverified}</td>
      <td className={cn(TD, 'border-slate-300')} />
    </tr>
  );
}

// ─── Store-code summary ──────────────────────────────────────────────────────

function CodeSummary({
  groups,
  activeCode,
  onPick,
}: {
  groups: CodeGroup<SetoranMonthRow>[];
  activeCode: string | null;
  onPick: (code: string | null) => void;
}) {
  const total = sumMonth(groups.flatMap((g) => g.rows));

  return (
    <div className="overflow-x-auto rounded-md border border-slate-300 bg-white">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr>
            {['Code', 'Brand', 'Stores', 'Belum Setor (hari)', 'Diterima (Rp)', 'Disetor (Rp)', 'Sisa Akhir (Rp)', 'Belum Verifikasi'].map((h, i) => (
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
          {groups.map((g) => {
            const t = sumMonth(g.rows);
            return (
              <tr
                key={g.code}
                onClick={() => onPick(activeCode === g.code ? null : g.code)}
                className={cn('cursor-pointer', activeCode === g.code ? 'bg-emerald-50' : 'bg-white hover:bg-slate-50')}
              >
                <td className={cn(TD, 'font-mono text-xs font-bold text-emerald-700')}>{g.display}</td>
                <td className={cn(TD, 'text-slate-700')}>{g.brand ?? <span className="text-slate-300">–</span>}</td>
                <td className={cn(TD, 'text-right tabular-nums')}>{g.rows.length}</td>
                <td className={cn(TD, 'text-right tabular-nums', t.missedDays > 0 ? 'bg-rose-50 font-semibold text-rose-700' : 'text-slate-300')}>
                  {t.missedDays > 0 ? t.missedDays : '–'}
                </td>
                <td className={cn(TD, 'text-right')}><Amount value={t.totalReceived} /></td>
                <td className={cn(TD, 'text-right')}><Amount value={t.totalStored} /></td>
                <td className={cn(TD, 'text-right')}><Amount value={t.closingUnpaid} tone="teal" /></td>
                <td className={cn(TD, 'text-right tabular-nums', t.unverified > 0 ? 'bg-amber-50 font-semibold text-amber-800' : 'text-slate-300')}>
                  {t.unverified > 0 ? t.unverified : '–'}
                </td>
              </tr>
            );
          })}
          <tr className="border-y-2 border-slate-400 bg-emerald-50 font-semibold text-slate-900">
            <td className={TD} />
            <td className={cn(TD, 'text-right text-xs uppercase tracking-wide')}>Total</td>
            <td className={cn(TD, 'text-right tabular-nums')}>{total.stores}</td>
            <td className={cn(TD, 'text-right tabular-nums')}>{total.missedDays}</td>
            <td className={cn(TD, 'text-right tabular-nums')}>{num(total.totalReceived)}</td>
            <td className={cn(TD, 'text-right tabular-nums')}>{num(total.totalStored)}</td>
            <td className={cn(TD, 'text-right tabular-nums')}>{num(total.closingUnpaid)}</td>
            <td className={cn(TD, 'text-right tabular-nums')}>{total.unverified}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function FinanceSetoranReportPage() {
  const [month, setMonth] = useState(currentMonth);
  const [rows, setRows] = useState<SetoranMonthRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [view, setView] = useState<View>('all');
  const [code, setCode] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [onlyIssues, setOnlyIssues] = useState(false);

  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let stale = false;
    setLoading(true);
    setError(null);

    fetch(`/api/finance/setoran/report?month=${month}`, { cache: 'no-store' })
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
  const allGroups = useMemo(() => groupRowsByCode(rows), [rows]);

  const matching = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (onlyIssues && !hasIssue(r)) return false;
      if (!q) return true;
      return [r.storeNo, r.storeName, r.areaName].some((v) => v.toLowerCase().includes(q));
    });
  }, [rows, onlyIssues, search]);

  const summaryGroups = useMemo(() => groupRowsByCode(matching), [matching]);
  const visibleRows = useMemo(() => (code ? matching.filter((r) => r.code === code) : matching), [matching, code]);
  const visibleGroups = useMemo(() => groupRowsByCode(visibleRows), [visibleRows]);

  const totals = sumMonth(visibleRows);
  const storesWithIssues = visibleRows.filter(hasIssue).length;
  const filtered = Boolean(code || search || onlyIssues);

  async function handleDownload() {
    setDownloading(true);
    try {
      const qs = new URLSearchParams({ month });
      if (code) qs.set('code', code);
      if (onlyIssues) qs.set('issues', '1');
      await downloadXlsx(`/api/finance/setoran/export?${qs}`, `setoran-report_${month}.xlsx`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Download failed.');
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
                Finance · Setoran
              </p>
              <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-slate-900">Setoran Report</h1>
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
            <SetoranTabs />
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-[1400px] space-y-4 px-6 py-5 lg:px-8">
        {/* Key numbers */}
        {!loading && !error && (
          <KpiStrip
            items={[
              { label: `Diterima · ${reportMonthLabel(month)}`, value: rp(totals.totalReceived), sub: `${visibleRows.length} toko` },
              { label: 'Disetor', value: rp(totals.totalStored), sub: `${totals.depositDays} hari setor` },
              { label: 'Sisa akhir bulan', value: rp(totals.closingUnpaid), sub: 'belum disetor' },
              { label: 'Hari belum setor', value: String(totals.missedDays), sub: `${storesWithIssues} toko bermasalah`, warn: totals.missedDays > 0 },
              { label: 'Belum diverifikasi', value: String(totals.unverified), sub: 'setoran menunggu Finance', warn: totals.unverified > 0 },
            ]}
          />
        )}

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <ViewToggle value={view} onChange={setView} />
          <CodeChips groups={allGroups} total={rows.length} active={code} onPick={setCode} />

          <div className="relative min-w-[200px] max-w-xs flex-1">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search store, code, area…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 w-full rounded-md border border-slate-300 bg-white pl-9 pr-3 text-sm placeholder-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
            />
          </div>

          <label className="flex cursor-pointer select-none items-center gap-2 text-xs font-medium text-slate-600">
            <input
              type="checkbox"
              checked={onlyIssues}
              onChange={(e) => setOnlyIssues(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-slate-300 accent-emerald-600"
            />
            Only stores with issues
          </label>

          {filtered && (
            <button
              type="button"
              onClick={() => { setCode(null); setSearch(''); setOnlyIssues(false); }}
              className="text-xs font-semibold text-slate-500 underline hover:text-slate-700"
            >
              Clear
            </button>
          )}
        </div>

        {error && (
          <div className="flex items-center gap-3 rounded-md border border-rose-200 bg-rose-50 px-4 py-3">
            <AlertTriangle className="h-4 w-4 shrink-0 text-rose-500" />
            <p className="text-sm font-medium text-rose-700">{error}</p>
          </div>
        )}

        {/* Sheet */}
        {loading ? (
          <div className="overflow-hidden rounded-md border border-slate-300 bg-white">
            <div className="h-9 animate-pulse bg-slate-100" />
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-10 animate-pulse border-t border-slate-100 bg-white even:bg-slate-50/60" />
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
              <table className="w-full min-w-[1080px] border-separate border-spacing-0 text-left">
                <thead>
                  <tr>
                    <th className={cn(TH, 'w-11 text-center')}>No</th>
                    <th className={cn(TH, 'text-left')}>Kode</th>
                    <th className={cn(TH, 'text-left')}>Nama Toko</th>
                    <th className={cn(TH, 'text-center')}>Hari Kerja</th>
                    <th className={cn(TH, 'text-center')}>Setor</th>
                    <th className={cn(TH, 'text-center')}>Tanpa Setoran</th>
                    <th className={cn(TH, 'text-center')}>Belum Setor</th>
                    <th className={cn(TH, 'text-right')}>Diterima (Rp)</th>
                    <th className={cn(TH, 'text-right')}>Disetor (Rp)</th>
                    <th className={cn(TH, 'text-right')}>Sisa Akhir (Rp)</th>
                    <th className={cn(TH, 'text-center')}>Belum Verifikasi</th>
                    <th className={cn(TH, 'text-center')}>Setor Terakhir</th>
                  </tr>
                </thead>

                <tbody>
                  {view === 'all'
                    ? visibleRows.map((row, i) => <StoreLine key={row.storeId} row={row} index={i + 1} />)
                    : visibleGroups.map((g) => <GroupBlock key={g.code} group={g} />)}
                  <TotalLine label="Total" rows={visibleRows} tone="grand" />
                </tbody>
              </table>
            </div>

            <p className="text-[11px] text-slate-500">
              Hari Kerja = hari dengan jadwal shift pembuka sampai hari ini. Setor = disubmit dengan uang disetor;
              Tanpa Setoran = disubmit tanpa setoran (tidak ada / di bawah Rp 50.000); Belum Setor = hari kerja yang
              sudah lewat tanpa submit. Sisa Akhir = saldo yang masih harus disetor pada akhir {reportMonthLabel(month)}.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function GroupBlock({ group }: { group: CodeGroup<SetoranMonthRow> }) {
  return (
    <>
      <GroupHeaderRow colSpan={COLS} group={group} />
      {group.rows.map((row, i) => (
        <StoreLine key={row.storeId} row={row} index={i + 1} />
      ))}
      <TotalLine label={`Subtotal ${group.display}`} rows={group.rows} tone="sub" />
    </>
  );
}
