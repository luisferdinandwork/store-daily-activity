'use client';
// The two side sheets of Jadwal per toko: one store's rule (also "add a store"),
// and a bulk change over the stores ticked in the list.

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { StoreCombobox } from '@/components/shared/store-combobox';
import RuleFields, { type RuleValue } from './RuleFields';
import { VISIT_CATEGORY_LABELS, type VisitPolicy } from '@/lib/store-visit/types';
import type { StoreOption } from '@/lib/store-visit/settings-view';

const input = 'mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-base focus:outline-none focus:ring-2 focus:ring-cyan-200 md:text-sm';
const primary = 'min-h-12 w-full bg-cyan-700 hover:bg-cyan-800';

export function PolicySheet({ draft, isNew, newStores, stores, saving, error, onChange, onSave, onClose }: {
  draft: VisitPolicy | null;
  isNew: boolean;
  newStores: StoreOption[];
  stores: StoreOption[];
  saving: boolean;
  error: string;
  onChange: (policy: VisitPolicy) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const invalid = !draft || !draft.storeNo || !draft.city.trim() || !draft.manager.trim() || !draft.intervalDays || !draft.minimumVisits || draft.minimumVisits > draft.intervalDays;
  return (
    <Sheet open={draft !== null} onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
      <SheetContent className="overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{isNew ? 'Tambah toko' : 'Atur jadwal visit'}</SheetTitle>
          <SheetDescription>Kategori, interval, dan minimum kunjungan per toko.</SheetDescription>
        </SheetHeader>
        {draft && (
          <div className="space-y-5 px-4 pb-6">
            <fieldset disabled={saving} className="min-w-0 space-y-5">
              {isNew
                ? <div><label htmlFor="visit-store" className="text-sm font-semibold">Toko</label><StoreCombobox id="visit-store" stores={newStores} modal value={stores.find((s) => s.storeNo === draft.storeNo)?.id ?? null} onChange={(id) => { const store = stores.find((s) => s.id === id); if (store) onChange({ ...draft, storeNo: store.storeNo, storeName: store.name }); }} /></div>
                : <div className="rounded-xl bg-slate-50 p-3"><p className="break-words font-bold text-slate-900">{draft.storeName}</p><p className="text-sm text-slate-500">{draft.storeNo}</p></div>}
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm font-semibold">Kota<input className={input} maxLength={200} value={draft.city} onChange={(e) => onChange({ ...draft, city: e.target.value })} /></label>
                <label className="block text-sm font-semibold">Penanggung jawab<input className={input} maxLength={200} value={draft.manager} onChange={(e) => onChange({ ...draft, manager: e.target.value })} /></label>
              </div>
              <RuleFields
                value={{ category: draft.category, intervalDays: draft.intervalDays, minimumVisits: draft.minimumVisits }}
                onChange={(v) => onChange({ ...draft, category: v.category ?? draft.category, intervalDays: v.intervalDays ?? 0, minimumVisits: v.minimumVisits ?? 0 })}
              />
              <p className="rounded-xl bg-cyan-50 p-3 text-sm text-cyan-900">Ringkasan: <b>{draft.minimumVisits || '?'} visit</b> dalam setiap <b>{draft.intervalDays || '?'} hari</b> · {VISIT_CATEGORY_LABELS[draft.category]}.</p>
            </fieldset>
            <p className="text-xs text-slate-500">Penanggung jawab hanya referensi; hak akses Ops mengikuti area toko di PRISM.</p>
            {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
            <Button className={primary} disabled={saving || invalid} onClick={onSave}>{saving && <Loader2 className="h-4 w-4 animate-spin" />}Simpan jadwal</Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

export type BulkChanges = { category?: VisitPolicy['category']; intervalDays?: number; minimumVisits?: number };

export function BulkSheet({ open, selected, saving, error, onSave, onClose }: {
  open: boolean;
  selected: VisitPolicy[];
  saving: boolean;
  error: string;
  onSave: (changes: BulkChanges) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState<RuleValue>({ category: null, intervalDays: null, minimumVisits: null });
  const changes: BulkChanges = {};
  if (value.category) changes.category = value.category;
  if (value.intervalDays) changes.intervalDays = value.intervalDays;
  if (value.minimumVisits) changes.minimumVisits = value.minimumVisits;
  const touched = Object.keys(changes).length > 0;
  const conflicts = selected.filter((p) => (changes.minimumVisits ?? p.minimumVisits) > (changes.intervalDays ?? p.intervalDays));
  const parts = [
    changes.category && `kategori ${VISIT_CATEGORY_LABELS[changes.category]}`,
    changes.intervalDays && `interval ${changes.intervalDays} hari`,
    changes.minimumVisits && `minimum ${changes.minimumVisits} visit`,
  ].filter(Boolean);

  return (
    <Sheet open={open} onOpenChange={(next) => { if (!next && !saving) onClose(); }}>
      <SheetContent className="overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Atur {selected.length} toko sekaligus</SheetTitle>
          <SheetDescription>Hanya yang Anda ubah di bawah yang berubah; sisanya tetap seperti sekarang.</SheetDescription>
        </SheetHeader>
        <div className="space-y-5 px-4 pb-6">
          <div className="flex max-h-24 flex-wrap gap-1 overflow-y-auto rounded-xl bg-slate-50 p-2.5">
            {selected.map((p) => <span key={p.storeNo} className="rounded-md bg-white px-1.5 py-0.5 text-[11px] font-semibold text-slate-600 ring-1 ring-inset ring-slate-200">{p.storeNo}</span>)}
          </div>
          <fieldset disabled={saving} className="min-w-0"><RuleFields keep value={value} onChange={setValue} /></fieldset>
          {touched && <p className="rounded-xl bg-cyan-50 p-3 text-sm text-cyan-900">Akan mengubah <b>{selected.length} toko</b>: {parts.join(', ')}.</p>}
          {conflicts.length > 0 && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{conflicts.length} toko akan punya minimum visit melebihi interval ({conflicts.slice(0, 3).map((p) => p.storeNo).join(', ')}{conflicts.length > 3 ? ', …' : ''}). Sesuaikan interval atau minimum.</p>}
          {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
          <Button className={primary} disabled={saving || !touched || conflicts.length > 0} onClick={() => onSave(changes)}>{saving && <Loader2 className="h-4 w-4 animate-spin" />}Terapkan ke {selected.length} toko</Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
