'use client';
// components/audit/cash-check/BeritaAcaraListView.tsx — every Berita Acara Pemeriksaan Kas of a month.

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, CheckCircle2, ChevronRight, CircleDashed, FileText, Plus, Search, Scale } from 'lucide-react';

import PanelPageHeader from '@/components/shared/PanelPageHeader';
import { cn } from '@/lib/utils';
import { jakartaTodayKey } from '@/lib/day-bucket';
import { isMonth, longDateId, monthLabelId, type CashCheckListRow } from '@/lib/audit-cash-check';
import { CashCheckTabs, DiffChip, fetchJson } from './kit';

export default function BeritaAcaraListView() {
  const [month, setMonth] = useState(() => jakartaTodayKey().slice(0, 7));
  const [result, setResult] = useState<{ month: string; rows: CashCheckListRow[]; error: string | null } | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let alive = true;
    fetchJson<{ rows: CashCheckListRow[] }>(`/api/audit/berita-acara?month=${month}`)
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
    return rows.filter((r) =>
      [r.storeNo, r.storeName, r.docNumber, r.holderName, r.auditorName].some((v) => v.toLowerCase().includes(q)),
    );
  }, [rows, search]);

  const complete = rows.filter((r) => r.modalDone && r.pettyDone).length;
  const withDiff = rows.filter((r) => r.finalDiff !== 0).length;

  return (
    <div className="min-h-full bg-slate-50">
      <PanelPageHeader
        scope="Audit · Pemeriksaan Kas"
        title={<><FileText />Berita Acara</>}
        subtitle="Berita Acara Pemeriksaan Kas per toko, siap dicetak"
        tabs={<CashCheckTabs />}
        actions={
          <Link
            href="/audit/cek-modal"
            className="flex items-center gap-1.5 rounded-xl bg-amber-500 px-4 text-sm font-bold text-white shadow-sm transition hover:bg-amber-600"
          >
            <Plus className="h-4 w-4" /> Pemeriksaan baru
          </Link>
        }
      />

      <div className="space-y-4 p-4 sm:p-6 lg:p-8">
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          <Tile icon={FileText} label="Berita Acara" value={rows.length} />
          <Tile icon={CheckCircle2} label="Lengkap" value={complete} hint="Modal + Petty Cash" />
          <Tile icon={Scale} label="Ada selisih" value={withDiff} tone={withDiff ? 'rose' : undefined} />
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="flex h-11 items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3 shadow-xs focus-within:border-amber-400 focus-within:ring-4 focus-within:ring-amber-100 sm:w-56">
            <CalendarDays className="h-4 w-4 shrink-0 text-amber-600" />
            <input
              type="month"
              value={month}
              max={jakartaTodayKey().slice(0, 7)}
              onChange={(e) => isMonth(e.target.value) && setMonth(e.target.value)}
              className="min-w-0 flex-1 bg-transparent text-base font-semibold text-slate-900 outline-none sm:text-sm"
              aria-label="Bulan"
            />
          </label>
          <label className="flex h-11 flex-1 items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3 shadow-xs focus-within:border-amber-400 focus-within:ring-4 focus-within:ring-amber-100">
            <Search className="h-4 w-4 shrink-0 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari toko, nomor, pemegang kas…"
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
              <p className="mt-2 text-sm font-semibold text-slate-600">{rows.length ? 'Tidak ada yang cocok' : 'Belum ada Berita Acara bulan ini'}</p>
              <p className="mt-0.5 text-xs text-slate-400">Mulai dari Cek Modal atau Cek Petty Cash — Berita Acara dibuat otomatis.</p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {shown.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/audit/berita-acara/${r.id}`}
                    className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-amber-50/50 active:bg-amber-50"
                  >
                    <span className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-xl bg-slate-100 text-slate-700">
                      <span className="text-[15px] font-extrabold leading-none">{Number(r.checkDate.slice(8))}</span>
                      <span className="mt-0.5 text-[9px] font-bold uppercase leading-none text-slate-400">
                        {monthLabelId(r.checkDate.slice(0, 7)).slice(0, 3)}
                      </span>
                    </span>
                    <div className="min-w-0 flex-1 @3xl:grid @3xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto] @3xl:items-center @3xl:gap-4">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-slate-900">
                          <span className="font-mono text-xs text-amber-700">{r.storeNo}</span> {r.storeName}
                        </p>
                        <p className="truncate text-xs text-slate-500">
                          No. {r.docNumber}
                          <span className="@3xl:hidden"> · {longDateId(r.checkDate)}</span>
                        </p>
                      </div>
                      <p className="hidden truncate text-xs text-slate-500 @3xl:block">
                        Pemegang kas <span className="font-semibold text-slate-700">{r.holderName || '—'}</span>
                        <br />
                        Auditor <span className="font-semibold text-slate-700">{r.auditorName || '—'}</span>
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 @3xl:mt-0 @3xl:justify-end">
                        <PartChip done={r.modalDone} label="Modal" />
                        <PartChip done={r.pettyDone} label="Petty Cash" />
                        {(r.modalDone || r.pettyDone) && <DiffChip diff={r.finalDiff} />}
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function PartChip({ done, label }: { done: boolean; label: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold',
        done ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-dashed border-slate-300 bg-white text-slate-400',
      )}
    >
      {done ? <CheckCircle2 className="h-3 w-3" /> : <CircleDashed className="h-3 w-3" />}
      {label}
    </span>
  );
}

function Tile({
  icon: Icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  hint?: string;
  tone?: 'rose';
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-3 shadow-xs sm:px-4">
      <span
        className={cn(
          'hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl sm:flex',
          tone === 'rose' ? 'bg-rose-50 text-rose-600' : 'bg-amber-50 text-amber-600',
        )}
      >
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <p className={cn('text-2xl font-extrabold tabular-nums leading-none', tone === 'rose' ? 'text-rose-600' : 'text-slate-900')}>{value}</p>
        <p className="mt-1 truncate text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
        {hint && <p className="hidden truncate text-[10px] text-slate-400 sm:block">{hint}</p>}
      </div>
    </div>
  );
}
