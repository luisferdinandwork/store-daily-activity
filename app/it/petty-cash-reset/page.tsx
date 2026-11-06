'use client';
// app/it/petty-cash-reset/page.tsx — IT only.
//
// Wipe the petty cash activity of ONE store, either one period or all of them (lib/petty-cash-reset.ts for the
// rules, lib/db/utils/petty-cash-reset.ts for what exactly goes). Pick a store, then reset a period from its
// row or every period from the button on top; the dialog previews the counts, offers a JSON backup and asks
// for the store code before anything is deleted.

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { ArrowLeft, Loader2, RotateCcw, Shield, Wallet } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import PanelPageHeader from '@/components/shared/PanelPageHeader';
import { OpsList } from '@/components/ops/layout/OpsList';
import { RefillStateChip } from '@/components/ops/petty-cash/shared';
import { StoreCombobox } from '@/components/shared/store-combobox';
import PettyCashResetDialog from '@/components/it/petty-cash-reset/PettyCashResetDialog';
import { STORE_STATUS_BADGE, STORE_STATUS_LABEL, type StoreStatus } from '@/lib/store-status';
import { PERIOD_STATUS_LABEL, periodLabel, type PeriodStatus } from '@/lib/petty-cash-period';
import type { ResetOverview, ResetPeriodRow, ResetScope, ResetStoreRow } from '@/lib/petty-cash-reset';

const rp = (value: number) => `Rp ${Math.round(value).toLocaleString('id-ID')}`;

const PERIOD_CHIP: Record<PeriodStatus, string> = {
  open: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  upcoming: 'bg-sky-50 text-sky-700 ring-sky-200',
  closed: 'bg-slate-100 text-slate-600 ring-slate-200',
};

async function api<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.success) throw new Error(json.error ?? 'Request gagal');
  return json as T;
}

function PeriodRow({ row, onReset }: { row: ResetPeriodRow; onReset: () => void }) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5 md:flex-nowrap">
      <div className="min-w-0 flex-1 basis-48">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="text-sm font-bold text-slate-900">{periodLabel(row.yearMonth)}</p>
          <span className={cn(
            'inline-flex items-center whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset',
            PERIOD_CHIP[row.status],
          )}>
            {PERIOD_STATUS_LABEL[row.status]}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-slate-500">
          {row.requests} request
          {row.requests > 0 && <> · {row.completed} selesai{row.waiting > 0 && <>, {row.waiting} belum selesai</>}</>}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 md:w-44">
        {row.refill ? (
          <>
            <RefillStateChip state={row.refill.state} />
            {row.refill.count > 1 && <span className="text-[11px] text-slate-400">{row.refill.count}× diajukan</span>}
          </>
        ) : (
          <span className="text-[11px] text-slate-400">Belum ada Refill</span>
        )}
      </div>

      <p className="shrink-0 text-sm font-semibold tabular-nums text-slate-700 md:w-32 md:text-right">
        {rp(row.balance)}
      </p>

      <button
        type="button"
        onClick={onReset}
        className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 text-xs font-bold text-rose-600 transition hover:bg-rose-50"
      >
        <RotateCcw className="h-3.5 w-3.5" /> Reset periode
      </button>
    </li>
  );
}

export default function ItPettyCashResetPage() {
  const { status: authStatus, data: session } = useSession();
  const router = useRouter();
  const isIt = session?.user?.role === 'it';

  const [stores, setStores] = useState<ResetStoreRow[]>([]);
  const [loadingStores, setLoadingStores] = useState(true);
  const [storeId, setStoreId] = useState<number | null>(null);
  const [overview, setOverview] = useState<ResetOverview | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(false);
  const [resetting, setResetting] = useState<ResetScope | null>(null);

  useEffect(() => {
    if (authStatus === 'loading') return;
    if (!session) { router.replace('/login'); return; }
    if (!isIt) router.replace('/it');
  }, [authStatus, session, isIt, router]);

  const loadStores = useCallback(async () => {
    try {
      const json = await api<{ stores: ResetStoreRow[] }>('/api/it/petty-cash-reset');
      setStores(json.stores);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal memuat toko');
    } finally {
      setLoadingStores(false);
    }
  }, []);

  const loadOverview = useCallback(async (id: number) => {
    setLoadingOverview(true);
    try {
      setOverview(await api<ResetOverview>(`/api/it/petty-cash-reset?storeId=${id}`));
    } catch (e) {
      setOverview(null);
      toast.error(e instanceof Error ? e.message : 'Gagal memuat periode');
    } finally {
      setLoadingOverview(false);
    }
  }, []);

  useEffect(() => { if (isIt) void loadStores(); }, [isIt, loadStores]);
  useEffect(() => {
    if (!isIt || storeId == null) { setOverview(null); return; }
    void loadOverview(storeId);
  }, [isIt, storeId, loadOverview]);

  const picked = useMemo(() => stores.find((s) => s.id === storeId) ?? null, [stores, storeId]);

  if (authStatus === 'loading' || !session) return (
    <div className="flex min-h-full items-center justify-center bg-slate-50">
      <Loader2 className="h-6 w-6 animate-spin text-cyan-400" />
    </div>
  );

  if (!isIt) return (
    <div className="flex min-h-full flex-col items-center justify-center gap-4 bg-slate-50 p-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50"><Shield className="h-8 w-8 text-red-500" /></div>
      <p className="text-base font-bold text-slate-800">Access Restricted</p>
      <p className="text-sm text-slate-500">Only IT can reset petty cash.</p>
    </div>
  );

  const hasData = overview != null && (overview.periods.length > 0 || overview.totals.requests > 0 || overview.totals.refillRequests > 0);

  return (
    <div className="min-h-full bg-slate-50">
      <PanelPageHeader
        scope="IT"
        title="Reset Petty Cash"
        subtitle="Hapus data petty cash satu toko — satu periode atau semua periode."
        actions={
          <Link
            href="/it"
            className="flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-600 hover:bg-slate-50"
          >
            <ArrowLeft className="h-4 w-4" />
            Dashboard
          </Link>
        }
      />

      <div className="space-y-4 px-4 py-5 sm:px-6 lg:px-8">
        <p className="text-xs text-slate-500">
          Reset menghapus request, Refill dan notifikasinya. Kategori, pengguna, toko, dan foto di penyimpanan tidak disentuh.
          Data yang dihapus tidak bisa dikembalikan dari aplikasi — unduh cadangannya di langkah konfirmasi.
        </p>

        <div className="max-w-md space-y-1.5">
          <label htmlFor="reset-store" className="text-xs font-bold text-slate-600">Toko</label>
          <StoreCombobox
            id="reset-store"
            stores={stores}
            value={storeId}
            onChange={setStoreId}
            loading={loadingStores}
          />
        </div>

        {storeId == null ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center">
            <Wallet className="mx-auto h-8 w-8 text-slate-300" />
            <p className="mt-3 text-sm font-semibold text-slate-700">Pilih toko dulu</p>
            <p className="mt-1 text-xs text-slate-400">Periodenya muncul di sini, siap di-reset satu per satu atau sekaligus.</p>
          </div>
        ) : loadingOverview && !overview ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-16 animate-pulse rounded-2xl bg-slate-100" />)}
          </div>
        ) : overview ? (
          <>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm sm:px-5">
              <div className="min-w-0 flex-1 basis-56">
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className="text-sm font-bold text-slate-900">{overview.store.name}</p>
                  <span className="font-mono text-xs text-slate-400">{overview.store.storeNo}</span>
                  <span className={cn(
                    'rounded px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset',
                    STORE_STATUS_BADGE[overview.store.status as StoreStatus] ?? 'bg-slate-100 text-slate-600 ring-slate-200',
                  )}>
                    {STORE_STATUS_LABEL[overview.store.status as StoreStatus] ?? overview.store.status}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-slate-500">
                  {overview.periods.length} periode · {overview.totals.requests} request · {overview.totals.refillRequests} Refill
                  {picked && overview.store.status !== 'active' && ' · toko tidak aktif: setelah reset tidak ada periode baru'}
                </p>
              </div>
              <button
                type="button"
                disabled={!hasData}
                onClick={() => setResetting({ type: 'all' })}
                className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-rose-600 px-3 text-xs font-bold text-white transition hover:bg-rose-700 disabled:opacity-40"
              >
                <RotateCcw className="h-3.5 w-3.5" /> Reset semua periode
              </button>
            </div>

            {overview.periods.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center">
                <Wallet className="mx-auto h-8 w-8 text-slate-300" />
                <p className="mt-3 text-sm font-semibold text-slate-700">Belum ada periode petty cash</p>
                <p className="mt-1 text-xs text-slate-400">
                  {hasData
                    ? 'Masih ada request atau Refill tanpa periode — “Reset semua periode” membersihkannya.'
                    : 'Toko ini belum punya data petty cash.'}
                </p>
              </div>
            ) : (
              <OpsList>
                {overview.periods.map((p) => (
                  <PeriodRow key={p.yearMonth} row={p} onReset={() => setResetting({ type: 'period', yearMonth: p.yearMonth })} />
                ))}
              </OpsList>
            )}
          </>
        ) : null}
      </div>

      {resetting && overview && (
        <PettyCashResetDialog
          key={resetting.type === 'all' ? 'all' : resetting.yearMonth}
          store={overview.store}
          scope={resetting}
          onClose={() => setResetting(null)}
          onDone={() => { void loadOverview(overview.store.id); void loadStores(); }}
        />
      )}
    </div>
  );
}
