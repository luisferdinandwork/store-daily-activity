'use client';
// Jadwal per toko: search / filter / sort bar, a tick-to-select list of every
// store's rule, and a bar for acting on the ticked stores. The list flows in the
// page (no scroll box of its own); long lists page in 50 at a time.

import { useEffect, useRef, useState } from 'react';
import { AlertCircle, ChevronRight, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { OpsFilterSelect, OpsSearchInput, OpsSortControl } from '@/components/ops/layout/OpsToolbar';
import { cn } from '@/lib/utils';
import {
  categoryLabel, filterPolicies, ruleOptions, SORT_OPTIONS, sortPolicies,
  type PolicyFilter, type SortKey, type StoreOption,
} from '@/lib/store-visit/settings-view';
import type { VisitPolicy } from '@/lib/store-visit/types';

const PAGE = 50;

export default function StoreRulesList({ policies, stores, selected, onSelectedChange, onEdit, onAdd, onBulk, canAdd, addCount, busy }: {
  policies: VisitPolicy[];
  stores: StoreOption[];
  selected: Set<string>;
  onSelectedChange: (next: Set<string>) => void;
  onEdit: (policy: VisitPolicy) => void;
  onAdd: () => void;
  onBulk: () => void;
  canAdd: boolean;
  addCount: number;
  busy: boolean;
}) {
  const [filter, setFilter] = useState<PolicyFilter>({ query: '', category: 'all', rule: 'all', registered: 'all' });
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'name', dir: 'asc' });
  const [limitState, setLimitState] = useState({ sig: '', n: PAGE });
  const selectAll = useRef<HTMLInputElement>(null);

  const registeredNos = new Set(stores.map((s) => s.storeNo));
  const unmatched = policies.filter((p) => !registeredNos.has(p.storeNo)).length;
  const rules = ruleOptions(policies);
  const rows = sortPolicies(filterPolicies(policies, filter, registeredNos), sort.key, sort.dir);
  const sig = JSON.stringify([filter, sort]);
  const limit = limitState.sig === sig ? limitState.n : PAGE;
  const shown = rows.slice(0, limit);
  const picked = rows.filter((p) => selected.has(p.storeNo)).length;
  const filtered = filter.query !== '' || filter.category !== 'all' || filter.rule !== 'all' || filter.registered !== 'all';

  useEffect(() => {
    if (selectAll.current) selectAll.current.indeterminate = picked > 0 && picked < rows.length;
  }, [picked, rows.length]);

  const toggle = (storeNo: string) => {
    const next = new Set(selected);
    if (next.has(storeNo)) next.delete(storeNo); else next.add(storeNo);
    onSelectedChange(next);
  };
  const toggleAll = () => {
    const next = new Set(selected);
    if (picked === rows.length) rows.forEach((p) => next.delete(p.storeNo)); else rows.forEach((p) => next.add(p.storeNo));
    onSelectedChange(next);
  };
  const setF = (change: Partial<PolicyFilter>) => setFilter((f) => ({ ...f, ...change }));

  return (
    <section className="space-y-3" aria-label="Jadwal per toko">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="min-w-0 max-w-xl text-sm text-slate-600">Minimum visit dihitung dari hari visit berbeda dalam interval terakhir (WIB). Centang beberapa toko untuk mengubah aturannya sekaligus.</p>
        <Button className="min-h-11 bg-cyan-700 hover:bg-cyan-800" disabled={busy || !canAdd} onClick={onAdd}>
          <Plus className="h-4 w-4" />Tambah toko{addCount > 0 && <span className="rounded-full bg-white/20 px-1.5 text-xs">{addCount}</span>}
        </Button>
      </div>

      {unmatched > 0 && (
        <p className="flex gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="min-w-0">{unmatched} kode toko dari Excel belum terdaftar di PRISM. Jadwalnya tersimpan dan berlaku saat kode toko yang sama ditambahkan.{' '}
            <button type="button" className="font-semibold underline" onClick={() => setF({ registered: filter.registered === 'missing' ? 'all' : 'missing' })}>{filter.registered === 'missing' ? 'Tampilkan semua' : 'Lihat toko ini'}</button>
          </span>
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <OpsSearchInput value={filter.query} onChange={(query) => setF({ query })} placeholder="Cari toko, kode, kota, atau penanggung jawab…" className="basis-full sm:basis-auto" />
        <OpsFilterSelect label="Kategori" value={filter.category} onChange={(category) => setF({ category })}>
          <option value="all">Semua kategori</option><option value="in_city">Dalam kota</option><option value="out_city">Luar kota</option>
        </OpsFilterSelect>
        <OpsFilterSelect label="Frekuensi" value={filter.rule} onChange={(rule) => setF({ rule })}>
          <option value="all">Semua frekuensi</option>
          {rules.map((r) => <option key={r.key} value={r.key}>{r.label} ({r.count})</option>)}
        </OpsFilterSelect>
        <OpsSortControl options={SORT_OPTIONS} sortKey={sort.key} sortDir={sort.dir} onChange={(next) => setSort({ key: next.key, dir: next.dir })} />
        {filtered && <button type="button" onClick={() => setFilter({ query: '', category: 'all', rule: 'all', registered: 'all' })} className="inline-flex h-10 items-center gap-1 rounded-xl px-2 text-xs font-semibold text-slate-500 hover:text-slate-800"><X className="h-3.5 w-3.5" />Reset</button>}
      </div>

      {rows.length > 0 ? (
        <div className="@container">
          <div className="flex items-center gap-3 rounded-t-2xl border border-b-0 border-slate-200 bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-600">
            <label className="flex min-h-9 cursor-pointer items-center gap-3">
              <input ref={selectAll} type="checkbox" checked={picked === rows.length && rows.length > 0} onChange={toggleAll} className="h-4 w-4 accent-cyan-700" />
              {picked > 0 ? `${picked} dipilih` : `Pilih semua ${filtered ? 'hasil' : 'toko'}`}
            </label>
            <span className="ml-auto font-normal text-slate-500">{rows.length}{filtered ? ` dari ${policies.length}` : ''} toko</span>
          </div>
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-b-2xl border border-slate-200 bg-white shadow-sm">
            {shown.map((p) => {
              const registered = registeredNos.has(p.storeNo);
              const on = selected.has(p.storeNo);
              return (
                <li key={p.storeNo} className={cn('flex items-stretch transition-colors hover:bg-slate-50', on && 'bg-cyan-50/60 hover:bg-cyan-50')}>
                  <label className="flex w-12 shrink-0 cursor-pointer items-center justify-center sm:w-14">
                    <input type="checkbox" checked={on} onChange={() => toggle(p.storeNo)} aria-label={`Pilih ${p.storeName}`} className="h-4 w-4 accent-cyan-700" />
                  </label>
                  <button type="button" onClick={() => onEdit(p)} aria-label={`Atur visit ${p.storeName}`} className="group flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1.5 py-3 pr-3 text-left outline-none focus-visible:bg-slate-50 @md:flex-nowrap sm:pr-4">
                    <span className="min-w-0 basis-full @md:flex-1 @md:basis-0">
                      <span className="block truncate text-sm font-semibold text-slate-900">{p.storeName}</span>
                      <span className="block truncate text-xs text-slate-500">
                        <span className="font-mono">{p.storeNo}</span> · {p.city}<span className="@2xl:hidden"> · {p.manager}</span>
                      </span>
                    </span>
                    <span className="hidden w-40 shrink-0 truncate text-xs text-slate-600 @2xl:block">{p.manager}</span>
                    <span className="flex shrink-0 items-center gap-2.5 @md:w-72 @md:justify-end @md:gap-3">
                      {!registered && <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] font-bold text-amber-800">Belum di PRISM</span>}
                      <span className={cn('rounded-md px-1.5 py-0.5 text-[11px] font-bold', p.category === 'in_city' ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-100 text-slate-600')}>{categoryLabel(p.category)}</span>
                      <span className="whitespace-nowrap text-sm font-semibold tabular-nums text-slate-800 @md:w-24 @md:text-right">{p.minimumVisits}<span className="font-normal text-slate-400"> / </span>{p.intervalDays} hr</span>
                    </span>
                    <ChevronRight className="hidden h-4 w-4 shrink-0 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-slate-500 @md:block" />
                  </button>
                </li>
              );
            })}
          </ul>
          {rows.length > shown.length && (
            <Button variant="outline" className="mt-3 min-h-11 w-full" onClick={() => setLimitState({ sig, n: limit + PAGE })}>Tampilkan {Math.min(PAGE, rows.length - shown.length)} lagi · sisa {rows.length - shown.length}</Button>
          )}
        </div>
      ) : (
        <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">{policies.length ? 'Tidak ada toko yang sesuai.' : 'Belum ada toko yang diatur. Klik Tambah toko.'}</p>
      )}

      {selected.size > 0 && (
        <div className="sticky bottom-3 z-20 flex flex-wrap items-center gap-2 rounded-2xl border border-cyan-200 bg-white/95 p-2.5 pl-4 shadow-lg backdrop-blur">
          <p className="mr-auto text-sm font-semibold text-slate-800">{selected.size} toko dipilih</p>
          <Button variant="outline" className="min-h-11" onClick={() => onSelectedChange(new Set())}>Batal pilih</Button>
          <Button className="min-h-11 bg-cyan-700 hover:bg-cyan-800" disabled={busy} onClick={onBulk}>Atur sekaligus</Button>
        </div>
      )}
    </section>
  );
}
