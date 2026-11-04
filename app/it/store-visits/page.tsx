'use client';
// IT · Pengaturan Visit Toko — each store's visit rule (category, interval, minimum
// visits). What Ops Area writes at a visit is fixed (Informasi Product / Informasi VM /
// Human Problem — lib/store-visit/fields.ts), so there is no checklist to edit here any
// more. Parts live in components/it/store-visits/*, view logic in lib/store-visit/settings-view.ts.

import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import OpsPageHeader from '@/components/ops/layout/OpsPageHeader';
import { StatTile } from '@/components/ops/store-visits/shared';
import StoreRulesList from '@/components/it/store-visits/StoreRulesList';
import { BulkSheet, PolicySheet, type BulkChanges } from '@/components/it/store-visits/RuleSheets';
import { VISIT_FIELDS } from '@/lib/store-visit/fields';
import { commonRule, type VisitSettings } from '@/lib/store-visit/settings-view';
import type { VisitPolicy } from '@/lib/store-visit/types';

const emptyPolicy: VisitPolicy = { storeNo: '', storeName: '', manager: '', city: '', category: 'in_city', intervalDays: 7, minimumVisits: 1 };

export default function StoreVisitSettingsPage() {
  const [settings, setSettings] = useState<VisitSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<VisitPolicy | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [sheetError, setSheetError] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkSeq, setBulkSeq] = useState(0);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/ops/store-visits/config', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Pengaturan gagal dimuat.');
      setSettings(data); setSelected(new Set());
    } catch (e) { setError(e instanceof Error ? e.message : 'Pengaturan gagal dimuat.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function send(body: unknown, fallback: string) {
    const res = await fetch('/api/ops/store-visits/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || fallback);
    return data;
  }

  const mergePolicies = (changed: VisitPolicy[]) => setSettings((prev) => {
    if (!prev) return prev;
    const nos = new Set(changed.map((p) => p.storeNo));
    return { ...prev, policies: [...prev.policies.filter((p) => !nos.has(p.storeNo)), ...changed] };
  });

  async function savePolicy() {
    if (!draft) return;
    setSaving(true); setSheetError('');
    try {
      await send({ kind: 'policy', policy: draft }, 'Jadwal gagal disimpan.');
      mergePolicies([draft]);
      setDraft(null);
      toast.success('Jadwal visit disimpan.');
    } catch (e) { setSheetError(e instanceof Error ? e.message : 'Jadwal gagal disimpan.'); }
    finally { setSaving(false); }
  }

  async function saveBulk(changes: BulkChanges) {
    setSaving(true); setSheetError('');
    try {
      const data = await send({ kind: 'bulk', storeNos: [...selected], changes }, 'Jadwal gagal disimpan.');
      mergePolicies(data.policies);
      toast.success(`Jadwal ${data.policies.length} toko diperbarui.`);
      setBulkOpen(false); setSelected(new Set());
    } catch (e) { setSheetError(e instanceof Error ? e.message : 'Jadwal gagal disimpan.'); }
    finally { setSaving(false); }
  }

  const policies = settings?.policies ?? [];
  const inCity = policies.filter((p) => p.category === 'in_city');
  const outCity = policies.filter((p) => p.category === 'out_city');
  const newStores = settings?.stores.filter((s) => !policies.some((p) => p.storeNo === s.storeNo)) ?? [];
  const openPolicy = (policy: VisitPolicy, creating = false) => { setIsNew(creating); setSheetError(''); setDraft({ ...policy }); };

  return <div className="min-h-full bg-slate-50">
    <OpsPageHeader title="Pengaturan Visit Toko" scope="IT · Konfigurasi" subtitle="Atur kategori toko dan frekuensi kunjungan." onRefresh={load} refreshing={loading} className="max-md:[&_h1]:text-xl" />
    <div className="space-y-5 p-4 pb-28 sm:p-6 sm:pb-28">
      {error && <div role="alert" className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-white p-4 text-rose-700"><AlertCircle className="mt-0.5 h-5 w-5 shrink-0" /><div><p className="font-semibold">{error}</p><button onClick={load} className="mt-1 min-h-11 text-sm font-semibold underline">Coba lagi</button></div></div>}
      {loading && !settings ? <div className="flex justify-center p-10"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div> : settings && <>
        <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
          <StatTile label="Isian visit" value={VISIT_FIELDS.length} hint="teks bebas, tetap" tone="indigo" />
          <StatTile label="Toko diatur" value={policies.length} hint={newStores.length ? `${newStores.length} toko PRISM belum` : `semua ${settings.stores.length} toko PRISM`} />
          <StatTile label="Dalam kota" value={inCity.length} hint={commonRule(inCity) ?? '–'} />
          <StatTile label="Luar kota" value={outCity.length} hint={commonRule(outCity) ?? '–'} />
        </div>

        <StoreRulesList
          policies={policies}
          stores={settings.stores}
          selected={selected}
          onSelectedChange={setSelected}
          onEdit={(p) => openPolicy(p)}
          onAdd={() => openPolicy({ ...emptyPolicy }, true)}
          onBulk={() => { setSheetError(''); setBulkSeq((n) => n + 1); setBulkOpen(true); }}
          canAdd={newStores.length > 0}
          addCount={newStores.length}
          busy={saving}
        />
      </>}
    </div>

    <PolicySheet draft={draft} isNew={isNew} newStores={newStores} stores={settings?.stores ?? []} saving={saving} error={sheetError} onChange={setDraft} onSave={savePolicy} onClose={() => setDraft(null)} />
    <BulkSheet key={bulkSeq} open={bulkOpen} selected={policies.filter((p) => selected.has(p.storeNo))} saving={saving} error={sheetError} onSave={saveBulk} onClose={() => setBulkOpen(false)} />
  </div>;
}
