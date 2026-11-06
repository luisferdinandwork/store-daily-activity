'use client';
// app/it/warehouse-codes/page.tsx
//
// IT keeps the list of Business Central location codes that are a WAREHOUSE (not a
// store). Every code starting with "DM" counts automatically; anything else is added
// here. A transfer to/from a warehouse code shows as "Gudang (code)" on the Ops and
// employee Transfer Order pages and never links to a store. Codes seen on transfer
// orders that are neither a store nor a warehouse are listed under "Belum dikenal"
// with a one-click add.

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, Plus, Shield, Trash2, Warehouse } from 'lucide-react';

import OpsPageHeader from '@/components/ops/layout/OpsPageHeader';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { WAREHOUSE_CODE_MAX, WAREHOUSE_NAME_MAX, normalizeWarehouseCode, validateWarehouseCode } from '@/lib/warehouse-codes';
import type { UnknownCodeRow, WarehouseCodeRow } from '@/lib/warehouse-codes';

const inputCls =
  'h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/20';

export default function WarehouseCodesPage() {
  const { data: session, status: authStatus } = useSession();
  const router = useRouter();
  const isIt = session?.user?.role === 'it';

  const [warehouses, setWarehouses] = useState<WarehouseCodeRow[]>([]);
  const [unknown, setUnknown] = useState<UnknownCodeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [removing, setRemoving] = useState<WarehouseCodeRow | null>(null);

  useEffect(() => {
    if (authStatus === 'loading') return;
    if (!session) { router.replace('/login'); return; }
    if (!isIt) router.replace('/');
  }, [authStatus, session, isIt, router]);

  const apply = (data: { warehouses?: WarehouseCodeRow[]; unknown?: UnknownCodeRow[] }) => {
    setWarehouses(data.warehouses ?? []);
    setUnknown(data.unknown ?? []);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/it/warehouse-codes', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data?.error ?? 'Gagal memuat kode gudang.');
      apply(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal memuat kode gudang.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (isIt) void load(); }, [isIt, load]);

  async function call(init: RequestInit, url = '/api/it/warehouse-codes'): Promise<boolean> {
    setBusy(true);
    try {
      const res = await fetch(url, init);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data?.error ?? 'Gagal menyimpan.');
      apply(data);
      if (data.message) toast.success(data.message);
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyimpan.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  const add = (c: string, n: string | null) =>
    call({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: c, name: n }),
    });

  async function submitForm(e: React.FormEvent) {
    e.preventDefault();
    const normalized = normalizeWarehouseCode(code);
    const problem = validateWarehouseCode(normalized);
    if (problem) { toast.error(problem); return; }
    if (await add(normalized, name.trim() || null)) { setCode(''); setName(''); }
  }

  if (authStatus === 'loading' || !session) return (
    <div className="flex min-h-full items-center justify-center bg-slate-50">
      <Loader2 className="h-6 w-6 animate-spin text-cyan-500" />
    </div>
  );

  if (!isIt) return (
    <div className="flex min-h-full flex-col items-center justify-center gap-4 bg-slate-50 p-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50"><Shield className="h-8 w-8 text-red-500" /></div>
      <p className="text-base font-bold text-slate-800">Access Restricted</p>
      <p className="text-sm text-slate-500">Only IT can manage warehouse codes.</p>
    </div>
  );

  return (
    <div className="min-h-full bg-slate-50">
      <OpsPageHeader
        scope="IT · Operations Setup"
        title="Warehouse Codes"
        subtitle={loading ? 'Loading…' : `${warehouses.length} kode gudang${unknown.length ? ` · ${unknown.length} belum dikenal` : ''}`}
        onRefresh={() => void load()}
        refreshing={loading}
      />

      <div className="space-y-5 px-4 py-5 sm:px-6 lg:px-8">
        <p className="text-xs leading-relaxed text-slate-500">
          Kode lokasi Business Central yang merupakan <b>gudang</b>, bukan toko. Semua kode berawalan <b>DM</b> otomatis dianggap gudang;
          kode lain bisa ditambahkan di sini. Transfer Order dari/ke kode gudang tampil sebagai <b>Gudang (kode)</b> di panel Ops dan
          aplikasi karyawan, dan tidak pernah dikaitkan dengan toko.
        </p>

        <form onSubmit={submitForm} className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
            Kode gudang
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              maxLength={WAREHOUSE_CODE_MAX}
              placeholder="mis. WH-JKT"
              className={`${inputCls} w-44 font-mono`}
            />
          </label>
          <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-xs font-semibold text-slate-600">
            Nama (opsional)
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={WAREHOUSE_NAME_MAX}
              placeholder="mis. Gudang Marketplace"
              className={`${inputCls} w-full`}
            />
          </label>
          <button
            type="submit"
            disabled={busy || !code.trim()}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-cyan-600 px-4 text-sm font-semibold text-white hover:bg-cyan-700 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Tambah
          </button>
        </form>

        {unknown.length > 0 && (
          <section className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
            <h2 className="text-sm font-bold text-amber-900">Belum dikenal</h2>
            <p className="mt-0.5 text-xs text-amber-800/80">
              Kode ini muncul di Transfer Order tetapi bukan toko dan bukan gudang. Jika kode itu gudang, tambahkan.
            </p>
            <ul className="mt-3 divide-y divide-amber-200/70 rounded-xl border border-amber-200 bg-white">
              {unknown.map((u) => (
                <li key={u.code} className="flex items-center gap-3 px-3 py-2">
                  <span className="font-mono text-sm font-semibold text-slate-800">{u.code}</span>
                  <span className="text-xs text-slate-400">{u.orderCount} TO</span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void add(u.code, null)}
                    className="ml-auto inline-flex h-8 items-center gap-1 rounded-md border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    <Warehouse className="h-3.5 w-3.5" /> Jadikan gudang
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h2 className="mb-2 text-sm font-bold text-slate-800">Kode gudang</h2>
          {loading && warehouses.length === 0 ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-cyan-400" /></div>
          ) : warehouses.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center">
              <Warehouse className="mx-auto h-8 w-8 text-slate-300" />
              <p className="mt-3 text-sm font-semibold text-slate-700">Belum ada kode gudang</p>
              <p className="mt-1 text-xs text-slate-500">Kode berawalan DM muncul otomatis begitu ada Transfer Order-nya.</p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white shadow-sm">
              {warehouses.map((w) => (
                <li key={w.code} className="flex items-center gap-3 px-4 py-3">
                  <Warehouse className="h-4 w-4 shrink-0 text-slate-400" />
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-sm font-semibold text-slate-900">{w.code}</p>
                    {w.name && <p className="truncate text-xs text-slate-500">{w.name}</p>}
                  </div>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                    {w.source === 'dm' ? 'Otomatis (DM)' : 'Ditambahkan IT'}
                  </span>
                  <span className="w-14 text-right text-xs tabular-nums text-slate-400">{w.orderCount} TO</span>
                  {w.id != null ? (
                    <button
                      type="button"
                      onClick={() => setRemoving(w)}
                      aria-label={`Hapus ${w.code}`}
                      className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  ) : (
                    <span className="h-8 w-8" />
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <ConfirmDialog
        open={removing != null}
        onOpenChange={(o) => { if (!o) setRemoving(null); }}
        title="Hapus dari daftar gudang?"
        description={removing ? `${removing.code} tidak lagi dikenali sebagai gudang. Transfer Order lama tetap seperti sekarang; yang baru dihitung ulang saat sinkronisasi berikutnya.` : ''}
        confirmLabel="Hapus"
        tone="danger"
        busy={busy}
        onConfirm={() => {
          const target = removing;
          if (target?.id == null) return;
          void call({ method: 'DELETE' }, `/api/it/warehouse-codes?id=${target.id}`).then(() => setRemoving(null));
        }}
      />
    </div>
  );
}
