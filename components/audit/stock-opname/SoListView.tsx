'use client';
// components/audit/stock-opname/SoListView.tsx — every Stock Opname (Berita Acara SO) of a month.

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronRight, FileText, ListChecks, Plus, Scale, Search } from 'lucide-react';

import PanelPageHeader from '@/components/shared/PanelPageHeader';
import { cn } from '@/lib/utils';
import { TONES } from '@/lib/status-theme';
import { jakartaTodayKey } from '@/lib/day-bucket';
import { idNumber, isMonth, longDateId, monthLabelId, signedPcs, soRupiah, type StockOpnameListRow } from '@/lib/audit-stock-opname';
import { fetchJson } from '@/components/audit/cash-check/kit';
import SoTabs from './SoTabs';

export default function SoListView() {
  const [month, setMonth] = useState(() => jakartaTodayKey().slice(0, 7));
  const [result, setResult] = useState<{ month: string; rows: StockOpnameListRow[]; error: string | null } | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let alive = true;
    fetchJson<{ rows: StockOpnameListRow[] }>(`/api/audit/stock-opname?month=${month}`)
      .then((d) => alive && setResult({ month, rows: d.rows, error: null }))
      .catch((e) => alive && setResult({ month, rows: [], error: e instanceof Error ? e.message : 'Gagal memuat.' }));
    return () => {
      alive = false;
    };
  }, [month]);

  const loading = result?.month !== month;
  const rows = useMemo(() => (loading ? [] : result?.rows ?? []), [loading, result]);
  const error = loading ? null : result?.error ?? null;

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => [r.storeNo, r.storeName, r.docNumber, r.holderName, r.auditorName].some((v) => v.toLowerCase().includes(q)));
  }, [rows, search]);

  const withDiff = rows.filter((r) => r.qtyDiff !== 0).length;
  const findings = rows.reduce((s, r) => s + r.findings, 0);

  return (
    <div className="min-h-full bg-slate-50">
      <PanelPageHeader
        scope="Audit · Cek Bin & SO"
        title={<><FileText />Berita Acara SO</>}
        subtitle="Berita Acara Stock Opname & Surat Pernyataan per toko, siap dicetak"
        tabs={<SoTabs />}
        hideTabsOnPhone
        compactActions
        actions={
          <Link
            href="/audit/stock-opname"
            aria-label="Stock Opname baru"
            className="flex h-11 w-11 items-center justify-center gap-1.5 rounded-xl bg-amber-500 text-sm font-bold text-white shadow-sm transition hover:bg-amber-600 md:w-auto md:px-4"
          >
            <Plus className="h-5 w-5 md:h-4 md:w-4" /> <span className="hidden md:inline">Stock Opname baru</span>
          </Link>
        }
      />

      <div className="space-y-3 p-3 sm:space-y-4 sm:p-6 lg:p-8">
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          <Tile icon={FileText} label="Stock Opname" value={rows.length} />
          <Tile icon={Scale} label="Ada selisih" value={withDiff} tone={withDiff ? 'rose' : undefined} />
          <Tile icon={ListChecks} label="Temuan" value={findings} />
        </div>

        <div className="flex gap-2">
          <label className="flex h-11 w-[11.5rem] shrink-0 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 shadow-xs focus-within:border-amber-400 focus-within:ring-4 focus-within:ring-amber-100 sm:w-56 sm:gap-2.5">
            <CalendarDays className="hidden h-4 w-4 shrink-0 text-amber-600 min-[400px]:block" />
            <input
              type="month"
              value={month}
              max={jakartaTodayKey().slice(0, 7)}
              onChange={(e) => isMonth(e.target.value) && setMonth(e.target.value)}
              className="min-w-0 flex-1 bg-transparent text-base font-semibold text-slate-900 outline-none sm:text-sm"
              aria-label="Bulan"
            />
          </label>
          <label className="flex h-11 min-w-0 flex-1 items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3 shadow-xs focus-within:border-amber-400 focus-within:ring-4 focus-within:ring-amber-100">
            <Search className="h-4 w-4 shrink-0 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari…"
              className="min-w-0 flex-1 bg-transparent text-base text-slate-900 outline-none placeholder:text-slate-400 sm:text-sm"
            />
          </label>
        </div>

        <div className="@container overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
            <p className="text-sm font-bold text-slate-800">{monthLabelId(month)}</p>
            <p className="text-xs text-slate-400">{shown.length} Berita Acara</p>
          </div>
          {loading ? (
            <ul className="divide-y divide-slate-100">
              {[0, 1, 2].map((i) => (
                <li key={i} className="h-[72px] animate-pulse bg-slate-50/60" />
              ))}
            </ul>
          ) : error ? (
            <p className="px-4 py-8 text-center text-sm text-rose-600">{error}</p>
          ) : shown.length === 0 ? (
            <div className="px-6 py-14 text-center">
              <FileText className="mx-auto h-9 w-9 text-slate-300" />
              <p className="mt-2 text-sm font-semibold text-slate-600">{rows.length ? 'Tidak ada yang cocok' : 'Belum ada stock opname bulan ini'}</p>
              <p className="mt-0.5 text-xs text-slate-400">Buka Stock Opname, pilih toko dan tanggal — Berita Acara dibuat saat disimpan.</p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {shown.map((r) => {
                const tone = r.qtyDiff === 0 ? TONES.success : r.qtyDiff < 0 ? TONES.danger : TONES.warning;
                return (
                  <li key={r.id}>
                    <Link href={`/audit/berita-acara-so/${r.id}`} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-amber-50/50 active:bg-amber-50">
                      <span className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-xl bg-slate-100 text-slate-700">
                        <span className="text-[15px] font-extrabold leading-none">{Number(r.soDate.slice(8))}</span>
                        <span className="mt-0.5 text-[9px] font-bold uppercase leading-none text-slate-400">{monthLabelId(r.soDate.slice(0, 7)).slice(0, 3)}</span>
                      </span>
                      <div className="min-w-0 flex-1 @3xl:grid @3xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto] @3xl:items-center @3xl:gap-4">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-slate-900">
                            <span className="font-mono text-xs text-amber-700">{r.storeNo}</span> {r.storeName}
                          </p>
                          <p className="truncate text-xs text-slate-500">
                            No. {r.docNumber}
                            <span className="@3xl:hidden"> · {longDateId(r.soDate)}</span>
                          </p>
                        </div>
                        <p className="hidden truncate text-xs text-slate-500 @3xl:block">
                          BC <span className="font-semibold text-slate-700">{idNumber(r.bcTotal)}</span> · Scan{' '}
                          <span className="font-semibold text-slate-700">{idNumber(r.scanTotal)}</span> pcs
                          <br />
                          Bin sesuai <span className="font-semibold text-slate-700">{r.binsMatch}</span> / {r.binsMatch + r.binsMismatch} di-scan
                          {r.binsTotal ? ` (dari ${r.binsTotal})` : ''}
                        </p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 @3xl:mt-0 @3xl:justify-end">
                          <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-bold tabular-nums', tone.chip)}>
                            <span className={cn('h-1.5 w-1.5 rounded-full', tone.dot)} />
                            {r.qtyDiff === 0 ? 'Sesuai' : signedPcs(r.qtyDiff)}
                          </span>
                          {r.valueTotal != null && r.valueTotal !== 0 && (
                            <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs font-semibold tabular-nums text-slate-600">{soRupiah(r.valueTotal)}</span>
                          )}
                          {r.findings > 0 && (
                            <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs font-semibold text-slate-600">{r.findings} temuan</span>
                          )}
                          <span
                            className={cn(
                              'rounded-full border px-2 py-0.5 text-xs font-semibold',
                              r.rewardRows == null ? 'border-dashed border-slate-300 bg-white text-slate-400' : TONES.success.chip,
                            )}
                            title={r.rewardRows == null ? 'Super Reward belum diisi' : `Super Reward: ${r.rewardRows} karyawan`}
                          >
                            {r.rewardRows == null ? 'Reward belum diisi' : 'Reward ✓'}
                          </span>
                        </div>
                      </div>
                      <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function Tile({ icon: Icon, label, value, tone }: { icon: React.ElementType; label: string; value: number; tone?: 'rose' }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-3 shadow-xs sm:px-4">
      <span className={cn('hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl sm:flex', tone === 'rose' ? 'bg-rose-50 text-rose-600' : 'bg-amber-50 text-amber-600')}>
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <p className={cn('text-2xl font-extrabold tabular-nums leading-none', tone === 'rose' ? 'text-rose-600' : 'text-slate-900')}>{value}</p>
        <p className="mt-1 truncate text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      </div>
    </div>
  );
}
