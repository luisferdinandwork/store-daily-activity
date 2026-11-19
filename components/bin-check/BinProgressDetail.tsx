'use client';
// components/bin-check/BinProgressDetail.tsx
//
// "Progres Cek Bin" of ONE store for one month (lib/bin-round.ts): the month's figures, today's 20-bin list, and
// every bin of the month as a list — Salah / Benar / Belum dicek (chips + search). A wrong bin opens to the item
// lines BC judged wrong on its first check (saved with the month, so it reads the same after BC has moved on).
//   Ops    /ops/bin-check/[storeId]       → /api/ops/bin-check/[storeId]
//   Audit  /audit/bin-progress/[storeId]  → /api/audit/bin-progress/[storeId] (+ a link to the day's BC detail)
// "Ambil ulang daftar bin" asks BC for the store's bin list again (in the background).

import Link from 'next/link';
import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { AlertTriangle, ArrowLeft, ChevronDown, ChevronRight, CircleDashed, DownloadCloud, ExternalLink, RefreshCw, ScanLine } from 'lucide-react';

import { cn } from '@/lib/utils';
import { TONES } from '@/lib/status-theme';
import { BIN_CHECK_REASON_META, skuToken } from '@/lib/bin-check';
import PanelPageHeader from '@/components/shared/PanelPageHeader';
import { OpsChipTabs, OpsSearchInput } from '@/components/ops/layout/OpsToolbar';
import {
  DAILY_BIN_COUNT,
  accuracyPct,
  compareBinCodes,
  daysToFinish,
  formatPct,
  isFixed,
  monthLabel,
  pendingBins,
  progressPct,
  shortDay,
  type BinProgressBin,
  type BinProgressDetail as Detail,
  type BinRoundStatus,
} from '@/lib/bin-round';
import {
  BinListLine,
  ErrorCard,
  KpiTile,
  MonthSwitcher,
  PANEL_ROUTES,
  Panel,
  ProgressBar,
  STATUS_LOOK,
  StatusChip,
  accuracyTone,
  currentYearMonth,
  useRoundFeed,
  withMonth,
  type RoundPanel,
} from './shared';

type Filter = 'wrong' | 'correct' | 'pending' | 'all';
const PAGE = 100;

export interface BinProgressDetailProps {
  panel: RoundPanel;
  storeId: number;
  initialMonth?: string;
  tabs?: ReactNode;
}

export default function BinProgressDetail({ panel, storeId, initialMonth, tabs }: BinProgressDetailProps) {
  const router = useRouter();
  const routes = PANEL_ROUTES[panel];
  const apiBase = routes.api;
  const scope = routes.scope;
  const backHref = (ym: string) => withMonth(routes.page, ym);
  const selfHref = (ym: string) => withMonth(`${routes.page}/${storeId}`, ym);
  const dayHref = routes.dayHref ? (date: string) => routes.dayHref!(storeId, date) : undefined;
  const [month, setMonth] = useState(initialMonth ?? currentYearMonth());
  const { data, error, loading, reload } = useRoundFeed<Detail>(`${apiBase}/${storeId}?month=${month}`);
  const [filter, setFilter] = useState<Filter | null>(null);
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [syncing, setSyncing] = useState(false);

  const changeMonth = (ym: string) => {
    setMonth(ym);
    setLimit(PAGE);
    router.replace(selfHref(ym), { scroll: false });
  };

  const bins = useMemo(() => data?.bins ?? [], [data]);
  const counts = useMemo(
    () => ({
      wrong: bins.filter((b) => b.status === 'wrong').length,
      correct: bins.filter((b) => b.status === 'correct').length,
      pending: bins.filter((b) => b.status === 'pending').length,
      all: bins.length,
    }),
    [bins],
  );
  // Start on the wrong bins when there are any, else on the ones still to check.
  const active: Filter = filter ?? (counts.wrong ? 'wrong' : counts.pending ? 'pending' : 'all');

  const shown = useMemo(() => {
    const needle = q.trim().toUpperCase();
    const list = bins.filter((b) => (active === 'all' || b.status === active) && (!needle || b.binCode.includes(needle)));
    const order: Record<BinRoundStatus, number> = { wrong: 0, pending: 1, correct: 2 };
    return list.sort((a, b) =>
      active === 'all'
        ? order[a.status] - order[b.status] || compareBinCodes(a.binCode, b.binCode)
        : active === 'pending'
          ? compareBinCodes(a.binCode, b.binCode)
          : (b.firstCheckedOn ?? '').localeCompare(a.firstCheckedOn ?? '') || compareBinCodes(a.binCode, b.binCode),
    );
  }, [bins, active, q]);

  const s = data?.stats ?? null;
  const isCurrent = month === currentYearMonth();

  const syncBins = async () => {
    setSyncing(true);
    try {
      const res = await fetch(`${apiBase}/${storeId}`, { method: 'POST' });
      const json = (await res.json().catch(() => ({}))) as { success?: boolean; queued?: boolean; error?: string };
      if (!res.ok || !json.success) throw new Error(json.error || `HTTP ${res.status}`);
      toast.success(json.queued ? 'Daftar bin sedang diambil dari BC — muat ulang dalam 1–2 menit.' : 'Daftar bin sedang diambil dari BC.');
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal meminta daftar bin.');
    } finally {
      setSyncing(false);
    }
  };

  const toggle = (code: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });

  const title = data ? `${data.store.storeNo} · ${data.store.name}` : 'Progres Cek Bin';

  return (
    <div className="min-h-full bg-slate-50">
      <PanelPageHeader
        scope={scope}
        title={<><ScanLine />{title}</>}
        subtitle={`${data?.store.areaName ? `${data.store.areaName} · ` : ''}Progres cek bin ${monthLabel(month)}`}
        tabs={tabs}
        hideTabsOnPhone
        wideActions
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={backHref(month)}
              className="flex h-10 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-600 hover:bg-slate-50"
            >
              <ArrowLeft className="h-4 w-4" /> Semua toko
            </Link>
            <MonthSwitcher value={month} onChange={changeMonth} />
            <button
              type="button"
              onClick={() => reload(true)}
              disabled={loading}
              aria-label="Muat ulang dari BC"
              title="Baca ulang hasil scan dari BC"
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-800 disabled:opacity-50"
            >
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            </button>
          </div>
        }
      />

      <div className="space-y-3 p-3 pb-8 sm:space-y-4 sm:p-6 lg:p-8">
        {error && !data && <ErrorCard message={error} onRetry={() => reload()} />}

        {data && (
          <>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <BinListLine sync={data.binList} excluded={isCurrent ? data.excludedBins : undefined} />
              {data.finalizedAt && <span className={cn('rounded-full border px-2 py-0.5 text-[11px] font-bold', TONES.neutral.chip)}>Bulan ditutup · angka tersimpan</span>}
              {data.resultsState && data.resultsState !== 'ok' && (
                <span className={cn('inline-flex items-center gap-1 text-xs font-semibold', TONES.warning.text)}>
                  <AlertTriangle className="h-3.5 w-3.5" /> Hasil scan BC belum bisa dibaca — angka dari bacaan terakhir
                </span>
              )}
              {isCurrent && (
                <button
                  type="button"
                  onClick={syncBins}
                  disabled={syncing || data.binList.state === 'syncing'}
                  className="ml-auto flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                >
                  <DownloadCloud className="h-4 w-4" /> Ambil ulang daftar bin
                </button>
              )}
            </div>

            {!s || s.totalBins === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-10 text-center text-sm text-slate-500">
                {isCurrent
                  ? 'Belum ada daftar bin untuk toko ini. Daftar diambil dari BC otomatis — muat ulang sebentar lagi.'
                  : `Tidak ada data cek bin untuk ${monthLabel(month)}.`}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                  <KpiTile label="Total bin" value={s.totalBins.toLocaleString('id-ID')} hint="bin di BC bulan ini" />
                  <KpiTile label="Sudah dicek" value={formatPct(progressPct(s))} tone="active" hint={`${s.checkedBins.toLocaleString('id-ID')} bin`}>
                    <ProgressBar pct={progressPct(s)} className="mt-2" />
                  </KpiTile>
                  <KpiTile label="Benar" value={s.correctBins.toLocaleString('id-ID')} tone="success" hint="cek pertama" />
                  <KpiTile
                    label="Salah"
                    value={s.wrongBins.toLocaleString('id-ID')}
                    tone="danger"
                    hint={s.fixedBins ? `${s.fixedBins} sudah diperbaiki` : 'cek pertama'}
                  />
                  <KpiTile
                    label="Belum dicek"
                    value={pendingBins(s).toLocaleString('id-ID')}
                    hint={isCurrent && pendingBins(s) ? `±${daysToFinish(pendingBins(s))} hari lagi (${DAILY_BIN_COUNT}/hari)` : isCurrent ? 'semua sudah dicek' : 'tidak dicek bulan itu'}
                  />
                  <KpiTile label="Akurasi" value={formatPct(accuracyPct(s))} tone={accuracyTone(accuracyPct(s))} hint="bin benar ÷ bin dicek" />
                </div>

                {isCurrent && (
                  <Panel
                    title="Bin hari ini"
                    meta={data.todayList ? `${data.todayList.checked}/${data.todayList.bins.length} sudah di-scan · ${shortDay(data.today)}` : shortDay(data.today)}
                  >
                    {data.todayList && data.todayList.bins.length ? (
                      <ol className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-4 xl:grid-cols-5 sm:px-5">
                        {data.todayList.bins.map((b) => (
                          <li
                            key={b.binCode}
                            className={cn(
                              'flex items-center gap-2 rounded-xl border px-2.5 py-2',
                              b.status === 'pending' ? 'border-slate-200 bg-white' : `${TONES[STATUS_LOOK[b.status].tone].border} ${TONES[STATUS_LOOK[b.status].tone].tint}`,
                            )}
                          >
                            <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-bold tabular-nums text-slate-500">
                              {b.position}
                            </span>
                            <div className="min-w-0">
                              <p className="break-all font-mono text-xs font-bold text-slate-900">{b.binCode}</p>
                              <p className={cn('text-[10px] font-semibold', TONES[STATUS_LOOK[b.status].tone].text)}>
                                {b.status === 'pending' ? 'Belum di-scan' : b.status === 'wrong' ? `Salah · ${b.wrongCount} item` : 'Benar'}
                              </p>
                            </div>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="flex items-center gap-2 px-4 py-4 text-sm text-slate-500 sm:px-5">
                        <CircleDashed className="h-4 w-4" />
                        {pendingBins(s) === 0
                          ? 'Semua bin bulan ini sudah dicek.'
                          : 'Daftar hari ini belum dibuat — dibuat saat staf membuka task Cek BIN hari ini.'}
                      </p>
                    )}
                  </Panel>
                )}

                <Panel title="Semua bin bulan ini" meta={`${counts.all.toLocaleString('id-ID')} bin`}>
                  <div className="space-y-2 border-b border-slate-100 px-4 py-3 sm:px-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <OpsChipTabs<Filter>
                        items={[
                          { key: 'wrong', label: 'Salah', count: counts.wrong, tone: 'rose' },
                          { key: 'correct', label: 'Benar', count: counts.correct, tone: 'emerald' },
                          { key: 'pending', label: 'Belum dicek', count: counts.pending, tone: 'slate' },
                          { key: 'all', label: 'Semua', count: counts.all },
                        ]}
                        value={active}
                        onChange={(f) => {
                          setFilter(f);
                          setLimit(PAGE);
                        }}
                      />
                      <OpsSearchInput value={q} onChange={(v) => { setQ(v); setLimit(PAGE); }} placeholder="Cari kode bin…" className="max-w-xs" />
                    </div>
                  </div>
                  {shown.length === 0 ? (
                    <p className="px-5 py-8 text-center text-sm text-slate-500">Tidak ada bin di sini.</p>
                  ) : (
                    <BinTable bins={shown.slice(0, limit)} open={open} onToggle={toggle} dayHref={dayHref} />
                  )}
                  {shown.length > limit && (
                    <div className="border-t border-slate-100 px-5 py-3 text-center">
                      <button type="button" onClick={() => setLimit((n) => n + PAGE * 3)} className="text-sm font-bold text-indigo-600 hover:text-indigo-800">
                        Tampilkan lebih banyak ({(shown.length - limit).toLocaleString('id-ID')} lagi)
                      </button>
                    </div>
                  )}
                </Panel>
              </>
            )}
          </>
        )}

        {loading && !data && <div className="h-64 animate-pulse rounded-2xl bg-slate-100" />}
      </div>
    </div>
  );
}

const TH = 'px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-slate-400';
const TD = 'px-3 py-2.5 align-top';

function BinTable({
  bins,
  open,
  onToggle,
  dayHref,
}: {
  bins: BinProgressBin[];
  open: Set<string>;
  onToggle: (code: string) => void;
  dayHref?: (date: string) => string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="bg-slate-50">
          <tr>
            <th className={cn(TH, 'pl-5')}>Bin</th>
            <th className={TH}>Status</th>
            <th className={TH}>Dicek</th>
            <th className={TH}>Hasil terakhir</th>
            <th className={cn(TH, 'text-right')}>Item salah</th>
            <th className={TH}>Di daftar harian</th>
            <th className={cn(TH, 'pr-5 text-right')}>Isi bin (BC)</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {bins.map((b) => {
            const expandable = b.status === 'wrong' && b.wrongLines.length > 0;
            const isOpen = expandable && open.has(b.binCode);
            const fixed = isFixed(b);
            return (
              <Fragment key={b.binCode}>
                <tr className={cn(expandable && 'cursor-pointer hover:bg-slate-50', isOpen && 'bg-slate-50')} onClick={expandable ? () => onToggle(b.binCode) : undefined}>
                  <td className={cn(TD, 'pl-5')}>
                    <div className="flex items-center gap-1.5">
                      {expandable ? (
                        isOpen ? <ChevronDown className="h-3.5 w-3.5 text-slate-400" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
                      ) : (
                        <span className="w-3.5" />
                      )}
                      <span className="font-mono text-xs font-bold text-slate-900">{b.binCode}</span>
                      {!b.inBc && <span className="text-[10px] font-semibold text-slate-400">(tidak ada lagi di BC)</span>}
                    </div>
                  </td>
                  <td className={TD}>
                    <StatusChip status={b.status} />
                  </td>
                  <td className={cn(TD, 'whitespace-nowrap text-xs text-slate-600')}>
                    {b.firstCheckedOn ? (
                      <>
                        {shortDay(b.firstCheckedOn)}
                        {b.checkDays > 1 && <span className="text-slate-400"> · {b.checkDays}× scan</span>}
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className={cn(TD, 'whitespace-nowrap text-xs')}>
                    {b.lastResult && b.lastCheckedOn && b.lastCheckedOn !== b.firstCheckedOn ? (
                      <span className={cn('font-semibold', TONES[STATUS_LOOK[b.lastResult].tone].text)}>
                        {fixed ? 'Sudah diperbaiki' : STATUS_LOOK[b.lastResult].label} · {shortDay(b.lastCheckedOn)}
                      </span>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className={cn(TD, 'text-right font-bold tabular-nums', b.firstWrongCount ? TONES.danger.strong : 'text-slate-300')}>
                    {b.status === 'wrong' ? b.firstWrongCount.toLocaleString('id-ID') : '—'}
                  </td>
                  <td className={cn(TD, 'whitespace-nowrap text-xs text-slate-600')}>
                    {b.timesAssigned ? `${b.timesAssigned}× · terakhir ${shortDay(b.lastAssignedOn)}` : <span className="text-slate-300">belum</span>}
                  </td>
                  <td className={cn(TD, 'pr-5 text-right text-xs tabular-nums text-slate-500')}>
                    {b.itemLines != null ? `${b.itemLines.toLocaleString('id-ID')} item · ${(b.quantity ?? 0).toLocaleString('id-ID')} qty` : '—'}
                  </td>
                </tr>
                {isOpen && (
                  <tr className="bg-slate-50/60">
                    <td colSpan={7} className="px-5 pb-4 pt-1">
                      <WrongLines bin={b} dayHref={dayHref} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function WrongLines({ bin, dayHref }: { bin: BinProgressBin; dayHref?: (date: string) => string }) {
  const qty = (n: number | null) => (n == null ? '–' : n.toLocaleString('id-ID'));
  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-2 text-xs text-slate-500">
        <span>
          Barang salah saat cek pertama ({shortDay(bin.firstCheckedOn)}){bin.firstWrongCount > bin.wrongLines.length ? ` · ${bin.wrongLines.length} dari ${bin.firstWrongCount} ditampilkan` : ''}
        </span>
        {dayHref && bin.firstCheckedOn && (
          <Link href={dayHref(bin.firstCheckedOn)} className="ml-auto inline-flex items-center gap-1 font-bold text-indigo-600 hover:text-indigo-800" onClick={(e) => e.stopPropagation()}>
            Detail scan BC <ExternalLink className="h-3 w-3" />
          </Link>
        )}
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
            <th className="px-3 py-1.5 text-left">SKU</th>
            <th className="px-3 py-1.5 text-left">Status BC</th>
            <th className="px-3 py-1.5 text-right">Qty scan</th>
            <th className="px-3 py-1.5 text-right">Qty bin</th>
            <th className="px-3 py-1.5 text-left">Actual bin</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {bin.wrongLines.map((l, i) => (
            <tr key={`${l.itemNo}-${l.variantCode}-${l.reason}-${i}`}>
              <td className="px-3 py-1.5 font-semibold text-slate-800 [overflow-wrap:anywhere]">{skuToken(l.itemNo, l.variantCode) || '—'}</td>
              <td className="px-3 py-1.5 text-slate-600">
                {BIN_CHECK_REASON_META[l.reason].label}
                {l.reason === 'unknown' && l.statusText ? ` (${l.statusText})` : ''}
              </td>
              <td className="px-3 py-1.5 text-right tabular-nums">{qty(l.scanQuantity)}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{qty(l.binQuantity)}</td>
              <td className="px-3 py-1.5 font-mono text-[11px] text-slate-600">{l.actualBinCodes.length ? l.actualBinCodes.join(', ') : '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
