'use client';
// components/bin-check/BinProgressOverview.tsx
//
// "Progres Cek Bin" — every store's monthly bin round (lib/bin-round.ts): how many of its BC bins were checked this
// month, how many were right / wrong, accuracy, and how far today's 20-bin list got. One page, two panels:
//   Ops    /ops/bin-check          → GET /api/ops/bin-check        (OPS Area = own area, HO / IT = all)
//   Audit  /audit/bin-progress     → GET /api/audit/bin-progress   (every store)
// A row opens the store's bins (BinProgressDetail). Past months show what was saved for them; each month starts
// over with every bin pending.

import { useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, ChevronDown, RefreshCw, ScanLine } from 'lucide-react';

import { cn } from '@/lib/utils';
import { TONES } from '@/lib/status-theme';
import PanelPageHeader from '@/components/shared/PanelPageHeader';
import { OpsList, OpsListRow, OpsListSkeleton } from '@/components/ops/layout/OpsList';
import { OpsChipTabs, OpsFilterSelect, OpsSearchInput, OpsSortControl } from '@/components/ops/layout/OpsToolbar';
import {
  DAILY_BIN_COUNT,
  EXCLUDED_BINS_TEXT,
  accuracyPct,
  formatPct,
  monthLabel,
  pendingBins,
  progressPct,
  storePhase,
  sumStats,
  type BinProgressOverview as Overview,
  type BinProgressPhase,
  type BinProgressStoreRow,
} from '@/lib/bin-round';
import {
  BinListLine,
  ErrorCard,
  KpiTile,
  MonthSwitcher,
  PANEL_ROUTES,
  PHASE_TONE,
  PhaseChip,
  ProgressBar,
  accuracyTone,
  currentYearMonth,
  useRoundFeed,
  withMonth,
  type RoundPanel,
} from './shared';

type SortKey = 'progress' | 'accuracy' | 'wrong' | 'pending' | 'store';
const SORTS: { key: SortKey; label: string }[] = [
  { key: 'progress', label: 'Progres' },
  { key: 'accuracy', label: 'Akurasi' },
  { key: 'wrong', label: 'Bin salah' },
  { key: 'pending', label: 'Belum dicek' },
  { key: 'store', label: 'Kode toko' },
];
const PHASES: BinProgressPhase[] = ['not_started', 'running', 'done', 'no_list'];

export interface BinProgressOverviewProps {
  panel: RoundPanel;
  initialMonth?: string;
  tabs?: ReactNode;
}

function sortValue(row: BinProgressStoreRow, key: SortKey): number | string | null {
  const s = row.stats;
  if (key === 'store') return row.storeNo;
  if (!s || s.totalBins === 0) return null;
  if (key === 'progress') return progressPct(s);
  if (key === 'accuracy') return accuracyPct(s);
  if (key === 'wrong') return s.wrongBins;
  return pendingBins(s);
}

export default function BinProgressOverview({ panel, initialMonth, tabs }: BinProgressOverviewProps) {
  const router = useRouter();
  const routes = PANEL_ROUTES[panel];
  const apiBase = routes.api;
  const scope = routes.scope;
  const detailHref = (storeId: number, ym: string) => withMonth(`${routes.page}/${storeId}`, ym);
  const selfHref = (ym: string) => withMonth(routes.page, ym);
  const [month, setMonth] = useState(initialMonth ?? currentYearMonth());
  const { data, error, loading, reload } = useRoundFeed<Overview>(`${apiBase}?month=${month}`);

  const [q, setQ] = useState('');
  const [area, setArea] = useState('all');
  const [phase, setPhase] = useState<'all' | BinProgressPhase>('all');
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'progress', dir: 'asc' });
  const [howOpen, setHowOpen] = useState(false);

  const changeMonth = (ym: string) => {
    setMonth(ym);
    router.replace(selfHref(ym), { scroll: false });
  };

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const areas = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rows) if (r.areaId != null) map.set(String(r.areaId), r.areaName ?? `Area ${r.areaId}`);
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], 'id'));
  }, [rows]);

  const inArea = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (area === 'all' || String(r.areaId) === area) &&
        (!needle || r.storeNo.toLowerCase().includes(needle) || r.storeName.toLowerCase().includes(needle) || (r.areaName ?? '').toLowerCase().includes(needle)),
    );
  }, [rows, area, q]);

  const counts = useMemo(() => {
    const c: Record<BinProgressPhase, number> = { no_list: 0, not_started: 0, running: 0, done: 0 };
    for (const r of inArea) c[storePhase(r)] += 1;
    return c;
  }, [inArea]);

  const shown = useMemo(() => {
    const list = inArea.filter((r) => phase === 'all' || storePhase(r) === phase);
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      const va = sortValue(a, sort.key);
      const vb = sortValue(b, sort.key);
      if (va == null && vb == null) return a.storeNo.localeCompare(b.storeNo, 'en', { numeric: true });
      if (va == null) return 1; // no data always last
      if (vb == null) return -1;
      const cmp = typeof va === 'string' ? va.localeCompare(String(vb), 'en', { numeric: true }) : va - (vb as number);
      return cmp * dir || a.storeNo.localeCompare(b.storeNo, 'en', { numeric: true });
    });
  }, [inArea, phase, sort]);

  const totals = useMemo(() => sumStats(inArea.map((r) => r.stats).filter((s): s is NonNullable<typeof s> => !!s)), [inArea]);
  const withRound = inArea.filter((r) => r.stats && r.stats.totalBins > 0).length;
  const isCurrent = month === currentYearMonth();
  const todayDone = inArea.filter((r) => r.today && r.today.assigned > 0 && r.today.checked >= r.today.assigned).length;
  const todayOpened = inArea.filter((r) => r.today && r.today.assigned > 0).length;

  return (
    <div className="min-h-full bg-slate-50">
      <PanelPageHeader
        scope={scope}
        title={<><ScanLine />Progres Cek Bin</>}
        subtitle={`${monthLabel(month)} · setiap toko cek ${DAILY_BIN_COUNT} bin per hari sampai semua bin BC selesai dicek`}
        tabs={tabs}
        hideTabsOnPhone
        wideActions
        actions={
          <div className="flex items-center gap-2">
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
        {data?.resultsState && data.resultsState !== 'ok' && (
          <div className={cn('flex items-start gap-2 rounded-2xl border px-4 py-3 text-sm', TONES.warning.chip)}>
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            Hasil scan dari Business Central belum bisa dibaca sekarang — angka di bawah dari bacaan terakhir.
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <KpiTile label="Toko" value={withRound.toLocaleString('id-ID')} hint={`${inArea.length} toko aktif · ${counts.done} selesai`} />
          <KpiTile label="Total bin" value={totals.totalBins.toLocaleString('id-ID')} hint="bin di BC bulan ini" />
          <KpiTile label="Sudah dicek" value={formatPct(progressPct(totals))} tone="active" hint={`${totals.checkedBins.toLocaleString('id-ID')} bin`}>
            <ProgressBar pct={progressPct(totals)} className="mt-2" />
          </KpiTile>
          <KpiTile label="Benar" value={totals.correctBins.toLocaleString('id-ID')} tone="success" hint="bin, cek pertama" />
          <KpiTile
            label="Salah"
            value={totals.wrongBins.toLocaleString('id-ID')}
            tone="danger"
            hint={totals.fixedBins ? `${totals.fixedBins.toLocaleString('id-ID')} sudah diperbaiki` : 'bin, cek pertama'}
          />
          <KpiTile
            label={isCurrent ? 'Hari ini' : 'Akurasi'}
            value={isCurrent ? `${todayDone}/${todayOpened}` : formatPct(accuracyPct(totals))}
            tone={isCurrent ? 'neutral' : accuracyTone(accuracyPct(totals))}
            hint={isCurrent ? `toko selesai 20 bin · akurasi ${formatPct(accuracyPct(totals))}` : 'bin benar ÷ bin dicek'}
          />
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <OpsSearchInput value={q} onChange={setQ} placeholder="Cari toko…" />
            {areas.length > 1 && (
              <OpsFilterSelect label="Area" value={area} onChange={setArea}>
                <option value="all">Semua area</option>
                {areas.map(([id, name]) => (
                  <option key={id} value={id}>{name}</option>
                ))}
              </OpsFilterSelect>
            )}
            <OpsSortControl
              options={SORTS}
              sortKey={sort.key}
              sortDir={sort.dir}
              onChange={({ key, dir, keyChanged }) => setSort({ key, dir: keyChanged ? (key === 'wrong' || key === 'pending' ? 'desc' : 'asc') : dir })}
            />
          </div>
          <OpsChipTabs
            items={[
              { key: 'all' as const, label: 'Semua', count: inArea.length },
              ...PHASES.map((p) => ({
                key: p,
                label: { not_started: 'Belum mulai', running: 'Berjalan', done: 'Selesai', no_list: 'Belum ada daftar bin' }[p],
                count: counts[p],
                tone: ({ no_list: 'slate', not_started: 'amber', running: 'indigo', done: 'emerald' } as const)[p],
              })),
            ]}
            value={phase}
            onChange={setPhase}
          />
        </div>

        {loading && !data ? (
          <OpsListSkeleton rows={8} />
        ) : shown.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-10 text-center text-sm text-slate-500">
            {rows.length === 0 ? 'Tidak ada toko aktif di area Anda.' : 'Tidak ada toko yang cocok dengan filter.'}
          </div>
        ) : (
          <div className="@container">
            <OpsList>
              {shown.map((r) => (
                <StoreRow key={r.storeId} row={r} isCurrent={isCurrent} onOpen={() => router.push(detailHref(r.storeId, month))} />
              ))}
            </OpsList>
          </div>
        )}

        <section className="rounded-2xl border border-slate-200 bg-white text-sm text-slate-600 shadow-sm">
          <button type="button" onClick={() => setHowOpen((o) => !o)} className="flex w-full items-center gap-2 px-4 py-3 text-left font-semibold text-slate-700">
            <ChevronDown className={cn('h-4 w-4 transition-transform', howOpen && 'rotate-180')} />
            Cara dihitung
          </button>
          {howOpen && (
            <ul className="list-disc space-y-1 px-9 pb-4 text-xs leading-relaxed">
              <li>Daftar bin = semua bin toko di Business Central (diperbarui otomatis ±sehari sekali), kecuali {EXCLUDED_BINS_TEXT}.</li>
              <li>Setiap hari toko mendapat {DAILY_BIN_COUNT} bin acak yang belum dicek bulan ini, diurutkan per lokasi. Bin yang sudah dicek tidak muncul lagi di bulan yang sama.</li>
              <li>Bin dihitung sudah dicek begitu ada hasil scan-nya di BC bulan ini — juga bila di-scan di luar daftar.</li>
              <li>Benar / Salah = hasil scan PERTAMA bin itu di bulan ini (bin salah bila satu barangnya salah). Bin salah yang di-scan benar di hari lain dihitung &quot;sudah diperbaiki&quot;, tapi tetap salah di akurasi.</li>
              <li>Akurasi = bin benar ÷ bin dicek. Setiap tanggal 1 semua bin mulai dari nol lagi; angka bulan lalu tersimpan.</li>
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function StoreRow({ row, isCurrent, onOpen }: { row: BinProgressStoreRow; isCurrent: boolean; onOpen: () => void }) {
  const s = row.stats;
  const phase = storePhase(row);
  const pct = s ? progressPct(s) : null;
  const acc = s ? accuracyPct(s) : null;

  return (
    <OpsListRow onClick={onOpen} className="@4xl:flex-nowrap">
      <div className="min-w-0 flex-1 basis-56">
        <div className="flex items-center gap-2">
          <span className={cn('h-2 w-2 flex-shrink-0 rounded-full', TONES[PHASE_TONE[phase]].dot)} />
          <p className="truncate text-sm font-bold text-slate-900">
            {row.storeNo} <span className="font-semibold text-slate-600">· {row.storeName}</span>
          </p>
        </div>
        <p className="mt-0.5 truncate pl-4 text-xs text-slate-400">{row.areaName ?? 'Tanpa area'}</p>
      </div>

      {phase === 'no_list' ? (
        <div className="flex min-w-0 flex-1 items-center gap-3 pl-4 @4xl:pl-0">
          <PhaseChip phase={phase} />
          <BinListLine sync={row.binList} className="truncate" />
        </div>
      ) : (
        <>
          <div className="w-full pl-4 @4xl:w-56 @4xl:pl-0">
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="font-bold tabular-nums text-slate-800">
                {s!.checkedBins.toLocaleString('id-ID')} / {s!.totalBins.toLocaleString('id-ID')} bin
              </span>
              <span className="font-semibold tabular-nums text-slate-500">{formatPct(pct)}</span>
            </div>
            <ProgressBar pct={pct} className="mt-1.5" />
          </div>
          <div className="flex items-center gap-4 pl-4 text-xs tabular-nums @4xl:w-60 @4xl:pl-0">
            <Count label="Benar" value={s!.correctBins} tone={TONES.success.strong} />
            <Count label="Salah" value={s!.wrongBins} tone={TONES.danger.strong} />
            <Count label="Belum" value={pendingBins(s!)} tone={TONES.neutral.text} />
          </div>
          <div className="flex items-center gap-4 pl-4 @4xl:w-48 @4xl:pl-0">
            <div className="text-xs">
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Akurasi</p>
              <p className={cn('text-sm font-black tabular-nums', TONES[accuracyTone(acc)].strong)}>{formatPct(acc)}</p>
            </div>
            {isCurrent && (
              <div className="text-xs">
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Hari ini</p>
                <p className="text-sm font-bold tabular-nums text-slate-700">
                  {row.today && row.today.assigned > 0 ? `${row.today.checked}/${row.today.assigned}` : <span className="text-xs font-semibold text-slate-400">belum dibuka</span>}
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </OpsListRow>
  );
}

function Count({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={cn('text-sm font-black', tone)}>{value.toLocaleString('id-ID')}</p>
    </div>
  );
}
