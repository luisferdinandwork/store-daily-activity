'use client';
// app/finance/uang-modal/report/page.tsx
//
// Finance · Uang Modal Report (monthly)
//
// One row per store for the month, laid out like the Petty Cash / Setoran
// reports — but built around the float's fill rate rather than money moved:
// how many work days the float was full, short of the cap, empty or never
// reported; the average fill; the total shortfall; and how many of the store's
// latest work days in a row were not full (a store that is short every day
// needs a call, not just a tick).
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
  hasMonthIssue,
  sumMonth,
  type CodeGroup,
  type UangModalMonthRow,
} from '@/lib/uang-modal-review';
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
  ViewToggle,
  downloadXlsx,
} from '@/components/finance/shared/sheet-kit';
import { UangModalTabs } from '@/components/finance/uang-modal/shared';

type View = 'all' | 'code';

const COLS = 14;

// ─── Cells ───────────────────────────────────────────────────────────────────

function Amount({ value, tone }: { value: number; tone?: 'amber' | 'bold' }) {
  if (value === 0) return <span className="tabular-nums text-slate-300">–</span>;
  return (
    <span
      className={cn(
        'tabular-nums',
        tone === 'amber' ? 'text-amber-700' : 'text-slate-900',
        tone === 'bold' && 'font-semibold',
      )}
    >
      {num(value)}
    </span>
  );
}

function Count({ value, tone }: { value: number; tone?: 'rose' | 'amber' | 'green' }) {
  if (value === 0) return <span className="tabular-nums text-slate-300">–</span>;
  return (
    <span
      className={cn(
        'tabular-nums',
        tone === 'rose' && 'rounded bg-rose-50 px-1.5 py-0.5 font-semibold text-rose-700 ring-1 ring-inset ring-rose-200',
        tone === 'amber' && 'rounded bg-amber-50 px-1.5 py-0.5 font-semibold text-amber-800 ring-1 ring-inset ring-amber-200',
        tone === 'green' && 'text-emerald-700',
        !tone && 'text-slate-900',
      )}
    >
      {value}
    </span>
  );
}

function FillBar({ pct }: { pct: number }) {
  return (
    <span className="flex items-center gap-2">
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200">
        <span
          className={cn('block h-full rounded-full', pct >= 100 ? 'bg-emerald-500' : pct >= 60 ? 'bg-amber-400' : 'bg-rose-400')}
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className="w-9 text-right text-xs tabular-nums text-slate-600">{pct}%</span>
    </span>
  );
}

function StoreLine({ row, index }: { row: UangModalMonthRow; index: number }) {
  const submitted = row.fullDays + row.shortDays + row.emptyDays;

  return (
    <tr className="bg-white text-[13px] hover:bg-emerald-50/40">
      <td className={cn(ROW_HEAD, 'w-11')}>{index}</td>
      <td className={cn(TD, 'w-24 whitespace-nowrap font-mono text-xs font-semibold text-slate-600')}>{row.storeNo}</td>
      <td className={cn(TD, 'min-w-48')}>
        <p className="font-medium text-slate-900">{row.storeName}</p>
        <p className="text-[11px] text-slate-500">{row.areaName}</p>
      </td>
      <td className={cn(TD, 'w-16 text-center')}><Count value={row.workDays} /></td>
      <td className={cn(TD, 'w-16 text-center')}><Count value={row.fullDays} tone="green" /></td>
      <td className={cn(TD, 'w-20 text-center')}><Count value={row.shortDays} tone="amber" /></td>
      <td className={cn(TD, 'w-16 text-center')}><Count value={row.emptyDays} tone="rose" /></td>
      <td className={cn(TD, 'w-20 text-center')}><Count value={row.missedDays} tone="rose" /></td>
      <td className={cn(TD, 'w-28 text-right')}><Amount value={row.avgCounted} /></td>
      <td className={cn(TD, 'w-36')}>{submitted > 0 ? <FillBar pct={row.avgFillPct} /> : <span className="text-slate-300">–</span>}</td>
      <td className={cn(TD, 'w-28 text-right')}><Amount value={row.totalShortfall} tone="amber" /></td>
      <td className={cn(TD, 'w-24 text-center')}>
        {row.notFullStreak === 0 ? (
          <span className="text-slate-300">–</span>
        ) : (
          <span
            title="Hari kerja terbaru berturut-turut yang modalnya tidak penuh (kurang, kosong, atau belum lapor)"
            className={cn(
              'rounded px-1.5 py-0.5 text-xs font-semibold tabular-nums ring-1 ring-inset',
              row.notFullStreak >= 3 ? 'bg-rose-50 text-rose-700 ring-rose-200' : 'bg-amber-50 text-amber-800 ring-amber-200',
            )}
          >
            {row.notFullStreak} hari
          </span>
        )}
      </td>
      <td className={cn(TD, 'w-24 text-center')}><Count value={row.unverified} tone="amber" /></td>
      <td className={cn(TD, 'w-24 whitespace-nowrap text-center text-xs text-slate-600')}>
        {row.lastSubmittedDate ? fmtDateShort(row.lastSubmittedDate) : <span className="text-slate-300">–</span>}
      </td>
    </tr>
  );
}

function TotalLine({ label, rows, tone }: { label: string; rows: UangModalMonthRow[]; tone: 'sub' | 'grand' }) {
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
      <td className={count}>{t.fullDays}</td>
      <td className={count}>{t.shortDays}</td>
      <td className={count}>{t.emptyDays}</td>
      <td className={count}>{t.missedDays}</td>
      <td className={cn(TD, 'border-slate-300')} />
      <td className={cn(TD, 'border-slate-300 text-xs font-medium text-slate-600')}>{t.totalCounted + t.totalShortfall > 0 ? `${t.fillPct}% terisi` : ''}</td>
      <td className={money}>{num(t.totalShortfall)}</td>
      <td className={cn(TD, 'border-slate-300')} />
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
  groups: CodeGroup<UangModalMonthRow>[];
  activeCode: string | null;
  onPick: (code: string | null) => void;
}) {
  const total = sumMonth(groups.flatMap((g) => g.rows));
  const headers = ['Code', 'Brand', 'Stores', 'Terisi', 'Belum Penuh (hari)', 'Belum Lapor (hari)', 'Total Kurang (Rp)', 'Belum Verifikasi'];

  return (
    <div className="overflow-x-auto rounded-md border border-slate-300 bg-white">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr>
            {headers.map((h, i) => (
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
            const flag = (n: number, cls: string) => cn(TD, 'text-right tabular-nums', n > 0 ? cls : 'text-slate-300');
            return (
              <tr
                key={g.code}
                onClick={() => onPick(activeCode === g.code ? null : g.code)}
                className={cn('cursor-pointer', activeCode === g.code ? 'bg-emerald-50' : 'bg-white hover:bg-slate-50')}
              >
                <td className={cn(TD, 'font-mono text-xs font-bold text-emerald-700')}>{g.display}</td>
                <td className={cn(TD, 'text-slate-700')}>{g.brand ?? <span className="text-slate-300">–</span>}</td>
                <td className={cn(TD, 'text-right tabular-nums')}>{g.rows.length}</td>
                <td className={cn(TD, 'text-right tabular-nums text-slate-700')}>{t.totalCounted + t.totalShortfall > 0 ? `${t.fillPct}%` : '–'}</td>
                <td className={flag(t.shortDays + t.emptyDays, 'bg-amber-50 font-semibold text-amber-800')}>{t.shortDays + t.emptyDays || '–'}</td>
                <td className={flag(t.missedDays, 'bg-rose-50 font-semibold text-rose-700')}>{t.missedDays || '–'}</td>
                <td className={cn(TD, 'text-right')}><Amount value={t.totalShortfall} tone="amber" /></td>
                <td className={flag(t.unverified, 'bg-amber-50 font-semibold text-amber-800')}>{t.unverified || '–'}</td>
              </tr>
            );
          })}
          <tr className="border-y-2 border-slate-400 bg-emerald-50 font-semibold text-slate-900">
            <td className={TD} />
            <td className={cn(TD, 'text-right text-xs uppercase tracking-wide')}>Total</td>
            <td className={cn(TD, 'text-right tabular-nums')}>{total.stores}</td>
            <td className={cn(TD, 'text-right tabular-nums')}>{total.totalCounted + total.totalShortfall > 0 ? `${total.fillPct}%` : '–'}</td>
            <td className={cn(TD, 'text-right tabular-nums')}>{total.shortDays + total.emptyDays}</td>
            <td className={cn(TD, 'text-right tabular-nums')}>{total.missedDays}</td>
            <td className={cn(TD, 'text-right tabular-nums')}>{num(total.totalShortfall)}</td>
            <td className={cn(TD, 'text-right tabular-nums')}>{total.unverified}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function FinanceUangModalReportPage() {
  const [month, setMonth] = useState(currentMonth);
  const [rows, setRows] = useState<UangModalMonthRow[]>([]);
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

    fetch(`/api/finance/uang-modal/report?month=${month}`, { cache: 'no-store' })
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
      if (onlyIssues && !hasMonthIssue(r)) return false;
      if (!q) return true;
      return [r.storeNo, r.storeName, r.areaName].some((v) => v.toLowerCase().includes(q));
    });
  }, [rows, onlyIssues, search]);

  const summaryGroups = useMemo(() => groupRowsByCode(matching), [matching]);
  const visibleRows = useMemo(() => (code ? matching.filter((r) => r.code === code) : matching), [matching, code]);
  const visibleGroups = useMemo(() => groupRowsByCode(visibleRows), [visibleRows]);

  const totals = sumMonth(visibleRows);
  const hasCap = totals.totalCounted + totals.totalShortfall > 0;
  const longStreaks = visibleRows.filter((r) => r.notFullStreak >= 3).length;
  const filtered = Boolean(code || search || onlyIssues);

  async function handleDownload() {
    setDownloading(true);
    try {
      const qs = new URLSearchParams({ month });
      if (code) qs.set('code', code);
      if (onlyIssues) qs.set('issues', '1');
      await downloadXlsx(`/api/finance/uang-modal/export?${qs}`, `uang-modal-report_${month}.xlsx`);
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
                Finance · Uang Modal
              </p>
              <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-slate-900">Uang Modal Report</h1>
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
            <UangModalTabs />
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-[1400px] space-y-4 px-6 py-5 lg:px-8">
        {/* Key numbers */}
        {!loading && !error && (
          <KpiStrip
            items={[
              { label: `Terisi dari batas · ${reportMonthLabel(month)}`, value: hasCap ? `${totals.fillPct}%` : '–', sub: `${totals.fullDays} hari penuh dari ${totals.fullDays + totals.shortDays + totals.emptyDays} hari lapor` },
              { label: 'Total kurang', value: rp(totals.totalShortfall), sub: 'dari batas harian, semua hari lapor', warn: totals.totalShortfall > 0 },
              { label: 'Hari belum penuh', value: String(totals.shortDays + totals.emptyDays), sub: `${totals.emptyDays} di antaranya kosong`, warn: totals.shortDays + totals.emptyDays > 0 },
              { label: 'Hari belum lapor', value: String(totals.missedDays), sub: `${longStreaks} toko belum penuh ≥ 3 hari berturut`, warn: totals.missedDays > 0 },
              { label: 'Belum diverifikasi', value: String(totals.unverified), sub: 'hitungan menunggu Finance', warn: totals.unverified > 0 },
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

            <div className="max-h-[68vh] overflow-auto [scrollbar-gutter:stable] rounded-md border border-slate-300 bg-white">
              <table className="w-full min-w-[1240px] border-separate border-spacing-0 text-left">
                <thead>
                  <tr>
                    <th className={cn(TH, 'w-11 text-center')}>No</th>
                    <th className={cn(TH, 'text-left')}>Kode</th>
                    <th className={cn(TH, 'text-left')}>Nama Toko</th>
                    <th className={cn(TH, 'text-center')}>Hari Kerja</th>
                    <th className={cn(TH, 'text-center')}>Penuh</th>
                    <th className={cn(TH, 'text-center')}>Belum Penuh</th>
                    <th className={cn(TH, 'text-center')}>Kosong</th>
                    <th className={cn(TH, 'text-center')}>Belum Lapor</th>
                    <th className={cn(TH, 'text-right')}>Rata-rata (Rp)</th>
                    <th className={cn(TH, 'text-left')}>Terisi</th>
                    <th className={cn(TH, 'text-right')}>Total Kurang (Rp)</th>
                    <th className={cn(TH, 'text-center')}>Belum Penuh Berturut</th>
                    <th className={cn(TH, 'text-center')}>Belum Verifikasi</th>
                    <th className={cn(TH, 'text-center')}>Lapor Terakhir</th>
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
              Hari Kerja = hari dengan jadwal shift pembuka sampai hari ini. Penuh = modal sesuai batas harian;
              Belum Penuh = kurang dari batas; Kosong = melapor tanpa uang; Belum Lapor = hari kerja yang sudah lewat
              tanpa laporan. Terisi = rata-rata isi modal dari batas pada hari yang dilaporkan. Belum Penuh Berturut =
              hari kerja terbaru berturut-turut yang tidak penuh (merah bila ≥ 3 hari).
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function GroupBlock({ group }: { group: CodeGroup<UangModalMonthRow> }) {
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
