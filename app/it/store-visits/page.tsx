'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowUp, ArrowDown, Plus, Trash2, Loader2, Camera, AlertCircle, ChevronRight, ListChecks, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import OpsPageHeader from '@/components/ops/layout/OpsPageHeader';
import { OpsSearchInput, OpsFilterSelect, OpsChipTabs } from '@/components/ops/layout/OpsToolbar';
import { StatTile } from '@/components/ops/store-visits/shared';
import { StoreCombobox } from '@/components/shared/store-combobox';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { VISIT_CATEGORY_LABELS, type VisitPolicy, type VisitTask } from '@/lib/store-visit/types';
import { createVisitId } from '@/lib/store-visit/client';

type StoreOption = { id: number; storeNo: string; name: string; status: string };
type Settings = { config: { tasks: VisitTask[]; version: number }; policies: VisitPolicy[]; stores: StoreOption[] };
type Tab = 'checklist' | 'stores';
const input = 'mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-cyan-200';
const emptyPolicy: VisitPolicy = { storeNo: '', storeName: '', manager: '', city: '', category: 'in_city', intervalDays: 7, minimumVisits: 1 };
const INTERVAL_PRESETS = [7, 14, 30, 60, 90];

export default function StoreVisitSettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [tasks, setTasks] = useState<VisitTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [draft, setDraft] = useState<VisitPolicy | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [policyError, setPolicyError] = useState('');
  const [tab, setTab] = useState<Tab>('checklist');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/ops/store-visits/config', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Pengaturan gagal dimuat.');
      setSettings(data); setTasks(data.config.tasks);
    } catch (e) { setError(e instanceof Error ? e.message : 'Pengaturan gagal dimuat.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function save(kind: 'tasks' | 'policy') {
    setSaving(true); setPolicyError('');
    try {
      const res = await fetch('/api/ops/store-visits/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(kind === 'tasks' ? { kind, tasks, version: settings?.config.version } : { kind, policy: draft }) });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Pengaturan gagal disimpan.');
      if (kind === 'tasks') setSettings((prev) => prev ? { ...prev, config: data.config } : prev);
      else {
        if (draft) setSettings((prev) => prev ? { ...prev, policies: [...prev.policies.filter((p) => p.storeNo !== draft.storeNo), draft].sort((a, b) => a.manager.localeCompare(b.manager) || a.city.localeCompare(b.city)) } : prev);
        setDraft(null);
      }
      toast.success('Pengaturan visit disimpan.');
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Pengaturan gagal disimpan.';
      if (kind === 'policy') setPolicyError(message); else toast.error(message);
    } finally { setSaving(false); }
  }
  function move(index: number, direction: -1 | 1) {
    setTasks((prev) => { const next = [...prev]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; return next; });
  }
  const dirty = JSON.stringify(tasks) !== JSON.stringify(settings?.config.tasks);
  const hasEmptyTask = tasks.some((t) => !t.label.trim());
  const policies = settings?.policies.filter((p) => (category === 'all' || category === p.category) && `${p.storeNo} ${p.storeName} ${p.manager} ${p.city}`.toLowerCase().includes(query.toLowerCase())) ?? [];
  const unmatched = settings?.policies.filter((p) => !settings.stores.some((s) => s.storeNo === p.storeNo)).length ?? 0;
  const newStores = settings?.stores.filter((s) => !settings.policies.some((p) => p.storeNo === s.storeNo)) ?? [];
  const inCity = settings?.policies.filter((p) => p.category === 'in_city').length ?? 0;
  const outCity = settings?.policies.filter((p) => p.category === 'out_city').length ?? 0;
  const openPolicy = (policy: VisitPolicy, creating = false) => { setIsNew(creating); setPolicyError(''); setDraft({ ...policy }); };

  return <div className="min-h-full bg-slate-50">
    <OpsPageHeader title="Pengaturan Visit Toko" scope="IT · Konfigurasi" subtitle="Atur checklist Ops Area, foto wajib, kategori toko, dan frekuensi kunjungan." onRefresh={load} refreshing={loading} className="max-md:[&_h1]:text-xl" />
    <div className="mx-auto max-w-5xl space-y-5 p-4 pb-28 sm:p-6 sm:pb-28">
      {error && <div role="alert" className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-white p-4 text-rose-700"><AlertCircle className="mt-0.5 h-5 w-5 shrink-0" /><div><p className="font-semibold">{error}</p><button onClick={load} className="mt-1 min-h-11 text-sm font-semibold underline">Coba lagi</button></div></div>}
      {loading && !settings ? <div className="flex justify-center p-10"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div> : settings && <>
        <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
          <StatTile label="Task checklist" value={settings.config.tasks.length} hint={`${settings.config.tasks.filter((t) => t.requirePhoto).length} wajib foto`} tone="indigo" />
          <StatTile label="Toko diatur" value={settings.policies.length} hint={`${settings.stores.length} toko di PRISM`} />
          <StatTile label="Dalam kota" value={inCity} hint="umumnya 1 visit / 7 hari" />
          <StatTile label="Luar kota" value={outCity} hint="60 – 90 hari" />
        </div>

        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0 [&>div]:flex-nowrap">
          <OpsChipTabs<Tab> value={tab} onChange={setTab} items={[
            { key: 'checklist', label: 'Checklist visit', count: settings.config.tasks.length },
            { key: 'stores', label: 'Jadwal per toko', count: settings.policies.length },
          ]} />
        </div>

        {tab === 'checklist' && <section className="space-y-3" aria-label="Checklist visit">
          <div className="flex gap-3 rounded-2xl border border-indigo-100 bg-indigo-50 p-4 text-sm text-indigo-900"><ListChecks className="mt-0.5 h-5 w-5 shrink-0" /><p>Checklist berlaku untuk <b>semua toko</b>. Foto toko dan geotag selalu wajib. Aktifkan <b>Foto wajib</b> pada task yang memerlukan bukti. Perubahan berlaku untuk visit berikutnya — visit yang sudah tersimpan tidak berubah.</p></div>
          <fieldset disabled={saving} className="space-y-2.5">
            {tasks.map((task, index) => <div key={task.id} className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
              <div className="flex items-start gap-3">
                <span className="mt-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-bold text-slate-600">{index + 1}</span>
                <label className="min-w-0 flex-1"><span className="sr-only">Task {index + 1}</span>
                  <textarea rows={2} className={`${input} mt-0 resize-none leading-6`} maxLength={250} placeholder="Tulis poin yang harus diperiksa…" value={task.label} onChange={(e) => setTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, label: e.target.value } : t))} />
                </label>
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 sm:pl-11">
                <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm font-medium text-slate-700"><Switch checked={task.requirePhoto} onCheckedChange={(v) => setTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, requirePhoto: v } : t))} className="data-[state=checked]:bg-cyan-600" /><Camera className={`h-4 w-4 ${task.requirePhoto ? 'text-cyan-700' : 'text-slate-400'}`} />Foto wajib</label>
                <div className="flex gap-1">
                  <Button type="button" variant="outline" className="h-11 w-11" aria-label={`Naikkan task ${index + 1}`} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp className="h-4 w-4" /></Button>
                  <Button type="button" variant="outline" className="h-11 w-11" aria-label={`Turunkan task ${index + 1}`} disabled={index === tasks.length - 1} onClick={() => move(index, 1)}><ArrowDown className="h-4 w-4" /></Button>
                  <Button type="button" variant="outline" className="h-11 w-11 text-rose-600 hover:bg-rose-50" aria-label={`Hapus task ${index + 1}`} disabled={tasks.length === 1} onClick={() => setTasks((prev) => prev.filter((t) => t.id !== task.id))}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </div>
            </div>)}
          </fieldset>
          <Button variant="outline" className="min-h-12 w-full border-dashed" disabled={saving || tasks.length >= 30} onClick={() => setTasks((prev) => [...prev, { id: createVisitId(), label: '', requirePhoto: false }])}><Plus className="h-4 w-4" />Tambah task{tasks.length >= 30 ? ' (maksimum 30)' : ''}</Button>
        </section>}

        {tab === 'stores' && <section className="space-y-4" aria-label="Jadwal per toko">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <p className="max-w-xl text-sm text-slate-600">Minimum visit dihitung dari hari visit berbeda dalam interval terakhir (WIB). Penanggung jawab dari Excel hanya referensi; hak akses Ops mengikuti area toko di PRISM.</p>
            <Button className="min-h-11 bg-cyan-700 hover:bg-cyan-800" disabled={saving || !newStores.length} onClick={() => openPolicy({ ...emptyPolicy }, true)}><Plus className="h-4 w-4" />Atur toko lain{newStores.length > 0 && <span className="rounded-full bg-white/20 px-1.5 text-xs">{newStores.length}</span>}</Button>
          </div>
          {unmatched > 0 && <p className="flex gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-800"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{unmatched} kode toko dari Excel belum terdaftar di PRISM. Jadwalnya tersimpan dan akan berlaku saat kode toko yang sama ditambahkan.</p>}
          <div className="flex flex-wrap items-center gap-2">
            <OpsSearchInput value={query} onChange={setQuery} placeholder="Cari toko, kota, atau penanggung jawab…" className="basis-full sm:basis-auto" />
            <OpsFilterSelect label="Kategori" value={category} onChange={setCategory}><option value="all">Semua kategori</option><option value="in_city">Dalam kota</option><option value="out_city">Luar kota</option></OpsFilterSelect>
            <span className="ml-auto text-xs text-slate-500">{policies.length} toko</span>
          </div>
          {policies.length > 0 && <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="max-h-[70vh] overflow-auto">
              <table className="w-full min-w-[34rem] border-collapse text-left text-[13px]">
                <thead className="sticky top-0 z-10 bg-slate-50 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                  <tr className="border-b border-slate-200">
                    <th scope="col" className="px-3 py-2 font-bold">Toko</th>
                    <th scope="col" className="hidden px-3 py-2 font-bold md:table-cell">Kota</th>
                    <th scope="col" className="hidden px-3 py-2 font-bold lg:table-cell">Penanggung jawab</th>
                    <th scope="col" className="px-3 py-2 font-bold">Kategori</th>
                    <th scope="col" className="px-3 py-2 text-right font-bold">Visit</th>
                    <th scope="col" className="w-8 px-2 py-2"><span className="sr-only">Atur</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {policies.map((policy) => {
                    const registered = settings.stores.some((s) => s.storeNo === policy.storeNo);
                    return <tr key={policy.storeNo} onClick={() => openPolicy(policy)} className="cursor-pointer transition-colors hover:bg-slate-50 focus-within:bg-slate-50">
                      <td className="max-w-[16rem] px-3 py-1.5">
                        <button type="button" aria-label={`Atur visit ${policy.storeName}`} onClick={(e) => { e.stopPropagation(); openPolicy(policy); }} className="block w-full min-w-0 text-left outline-none">
                          <span className="block truncate font-semibold text-slate-900">{policy.storeName}</span>
                          <span className="block truncate text-xs text-slate-500"><span className="font-mono">{policy.storeNo}</span><span className="md:hidden"> · {policy.city}</span>{!registered && <span className="ml-1.5 font-medium text-amber-700">Belum di PRISM</span>}</span>
                        </button>
                      </td>
                      <td className="hidden px-3 py-1.5 text-slate-600 md:table-cell">{policy.city}</td>
                      <td className="hidden max-w-[12rem] truncate px-3 py-1.5 text-slate-600 lg:table-cell">{policy.manager}</td>
                      <td className="px-3 py-1.5"><span className={`inline-block rounded-md px-1.5 py-0.5 text-[11px] font-bold ${policy.category === 'in_city' ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-100 text-slate-600'}`}>{VISIT_CATEGORY_LABELS[policy.category]}</span></td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-right font-semibold tabular-nums text-slate-800">{policy.minimumVisits}<span className="font-normal text-slate-400"> / </span>{policy.intervalDays} hr</td>
                      <td className="px-2 py-1.5 text-slate-300"><ChevronRight className="h-4 w-4" /></td>
                    </tr>;
                  })}
                </tbody>
              </table>
            </div>
          </div>}
          {!policies.length && <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">Tidak ada toko yang sesuai.</p>}
        </section>}
      </>}
    </div>

    {tab === 'checklist' && dirty && <div className="sticky bottom-0 z-20 border-t border-slate-200 bg-white/95 px-4 py-3 shadow-[0_-4px_16px_rgba(15,23,42,0.06)] backdrop-blur">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3">
        <p className="mr-auto flex items-center gap-2 text-sm font-semibold text-amber-700"><span className="h-2 w-2 rounded-full bg-amber-500" />Perubahan belum disimpan</p>
        <Button variant="outline" className="min-h-11" disabled={saving} onClick={() => setTasks(settings?.config.tasks ?? [])}><Undo2 className="h-4 w-4" />Batalkan</Button>
        <Button className="min-h-11 bg-cyan-700 hover:bg-cyan-800" disabled={saving || hasEmptyTask} onClick={() => save('tasks')}>{saving && <Loader2 className="h-4 w-4 animate-spin" />}Simpan checklist</Button>
      </div>
      {hasEmptyTask && <p className="mx-auto mt-1 max-w-5xl text-xs text-rose-600">Isi atau hapus task yang masih kosong.</p>}
    </div>}

    <Sheet open={draft !== null} onOpenChange={(open) => { if (!open && !saving) setDraft(null); }}>
      <SheetContent className="overflow-y-auto sm:max-w-lg"><SheetHeader><SheetTitle>{isNew ? 'Atur toko baru' : 'Atur jadwal visit'}</SheetTitle><SheetDescription>Kategori, interval, dan minimum kunjungan per toko.</SheetDescription></SheetHeader>
        {draft && <div className="space-y-5 px-4 pb-6">
          <fieldset disabled={saving} className="space-y-4">
            {isNew ? <div><label htmlFor="visit-store" className="text-sm font-semibold">Toko</label><StoreCombobox id="visit-store" stores={newStores} modal value={settings?.stores.find((s) => s.storeNo === draft.storeNo)?.id ?? null} onChange={(id) => { const store = settings?.stores.find((s) => s.id === id); if (store) setDraft({ ...draft, storeNo: store.storeNo, storeName: store.name }); }} /></div> : <div className="rounded-xl bg-slate-50 p-3"><p className="font-bold text-slate-900">{draft.storeName}</p><p className="text-sm text-slate-500">{draft.storeNo}</p></div>}
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-semibold">Kota<input className={input} maxLength={200} value={draft.city} onChange={(e) => setDraft({ ...draft, city: e.target.value })} /></label>
              <label className="block text-sm font-semibold">Penanggung jawab<input className={input} maxLength={200} value={draft.manager} onChange={(e) => setDraft({ ...draft, manager: e.target.value })} /></label>
            </div>
            <div>
              <p className="text-sm font-semibold">Kategori</p>
              <div className="mt-1 grid grid-cols-2 gap-2">{(['in_city', 'out_city'] as const).map((c) => <button key={c} type="button" aria-pressed={draft.category === c} onClick={() => setDraft({ ...draft, category: c })} className={`min-h-11 rounded-xl border text-sm font-semibold ${draft.category === c ? 'border-cyan-700 bg-cyan-700 text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}>{VISIT_CATEGORY_LABELS[c]}</button>)}</div>
            </div>
            <div>
              <p className="text-sm font-semibold">Interval (hari)</p>
              <div className="mt-1 flex flex-wrap gap-1.5">{INTERVAL_PRESETS.map((d) => <button key={d} type="button" aria-pressed={draft.intervalDays === d} onClick={() => setDraft({ ...draft, intervalDays: d, minimumVisits: Math.min(draft.minimumVisits || 1, d) })} className={`min-h-9 rounded-full px-3.5 text-xs font-bold ring-1 ring-inset ${draft.intervalDays === d ? 'bg-cyan-700 text-white ring-cyan-700' : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50'}`}>{d} hari</button>)}</div>
              <input className={input} type="number" inputMode="numeric" min={1} max={365} aria-label="Interval (hari)" value={draft.intervalDays || ''} onChange={(e) => setDraft({ ...draft, intervalDays: Number(e.target.value) })} />
            </div>
            <label className="block text-sm font-semibold">Minimum visit per interval<input className={input} type="number" inputMode="numeric" min={1} max={draft.intervalDays} value={draft.minimumVisits || ''} onChange={(e) => setDraft({ ...draft, minimumVisits: Number(e.target.value) })} /></label>
            <p className="rounded-xl bg-cyan-50 p-3 text-sm text-cyan-900">Ringkasan: <b>{draft.minimumVisits || '?'} visit</b> dalam setiap <b>{draft.intervalDays || '?'} hari</b>.</p>
          </fieldset>
          {policyError && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{policyError}</p>}
          <Button className="min-h-12 w-full bg-cyan-700 hover:bg-cyan-800" disabled={saving || !draft.storeNo} onClick={() => save('policy')}>{saving && <Loader2 className="h-4 w-4 animate-spin" />}Simpan jadwal</Button>
        </div>}
      </SheetContent>
    </Sheet>
  </div>;
}
