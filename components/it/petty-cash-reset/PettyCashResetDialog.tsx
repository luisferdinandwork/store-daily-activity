'use client';
// components/it/petty-cash-reset/PettyCashResetDialog.tsx
//
// IT-only: reset the petty cash of one store — one period or all of them. Loads a preview (counts, nothing
// changes) from /api/it/petty-cash-reset, offers the rows as a JSON backup, then asks IT to type the store code
// before POST goes through. See lib/db/utils/petty-cash-reset.ts for exactly what is kept and removed.

import { useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle, Download, Loader2, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';

import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { periodLabel, PERIOD_STATUS_LABEL } from '@/lib/petty-cash-period';
import { resetScopeTitle, type ResetPreview, type ResetResult, type ResetScope } from '@/lib/petty-cash-reset';
import { TX_STATUS_LABEL, isTxStatus } from '@/lib/petty-cash-transactions';

const rp = (n: number) => `Rp ${Math.round(n).toLocaleString('id-ID')}`;
const n = (v: number) => v.toLocaleString('id-ID');

/** `?storeId=…&scope=…[&month=…]` — the same query for the preview, the backup and the POST body's twin. */
function query(storeId: number, scope: ResetScope): string {
  const q = new URLSearchParams({ storeId: String(storeId), scope: scope.type });
  if (scope.type === 'period') q.set('month', scope.yearMonth);
  return q.toString();
}

function Warning({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <p>{children}</p>
    </div>
  );
}

export default function PettyCashResetDialog({
  store,
  scope,
  onClose,
  onDone,
}: {
  store: { id: number; storeNo: string; name: string };
  scope: ResetScope;
  onClose: () => void;
  /** Called after a successful reset, before the dialog closes. */
  onDone: (result: ResetResult) => void;
}) {
  const [preview, setPreview] = useState<ResetPreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  const title = resetScopeTitle(scope, periodLabel);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/it/petty-cash-reset?${query(store.id, scope)}`, { cache: 'no-store' })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data?.error ?? 'Gagal memeriksa data petty cash.');
        if (!cancelled) setPreview(data as ResetPreview);
      })
      .catch((err) => { if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err)); });
    return () => { cancelled = true; };
  }, [store.id, scope]);

  async function handleReset() {
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch('/api/it/petty-cash-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeId: store.id,
          scope: scope.type,
          month: scope.type === 'period' ? scope.yearMonth : undefined,
          confirmStoreNo: confirm,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data?.error ?? 'Gagal mereset petty cash.');
      const done = data as ResetResult;
      toast.success(
        `${title} · ${store.storeNo} direset — ${n(done.deleted.requests)} request`
        + (done.deleted.refillRequests ? `, ${n(done.deleted.refillRequests)} Refill` : '')
        + ' dihapus.',
      );
      onDone(done);
      onClose();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Gagal mereset petty cash.');
    } finally {
      setBusy(false);
    }
  }

  const matches = confirm.trim().toUpperCase() === store.storeNo.toUpperCase();

  let body: ReactNode;
  if (loadError) {
    body = <p className="text-rose-600">{loadError}</p>;
  } else if (!preview) {
    body = (
      <p className="flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Memeriksa data petty cash {store.storeNo}…
      </p>
    );
  } else {
    const byStatus = Object.entries(preview.requestsByStatus).map(([status, count]) => ({
      label: isTxStatus(status) ? TX_STATUS_LABEL[status] : status,
      count,
    }));
    const unfinished = (preview.requestsByStatus.pending_ops ?? 0) + (preview.requestsByStatus.ops_approved ?? 0);
    const after = preview.after;

    const lines: { label: string; count: number; hint?: string }[] = [
      { label: 'Request petty cash', count: preview.requests, hint: preview.requests ? `${rp(preview.completedAmount)} selesai` : undefined },
      { label: 'Request Refill', count: preview.refillRequests },
      ...(preview.legacyRefills ? [{ label: 'Refill akhir bulan (lama)', count: preview.legacyRefills }] : []),
      ...(scope.type === 'all' ? [{ label: 'Periode', count: preview.periodsRemoved }] : []),
      { label: 'Notifikasi terkait', count: preview.notifications },
    ];
    const nothing = lines.every((l) => l.count === 0);

    body = (
      <div className="space-y-3">
        <p>
          {scope.type === 'all'
            ? <>Semua data petty cash <b>{store.name}</b> ({store.storeNo}) dihapus: request, Refill dan periodenya.</>
            : <>Request dan Refill <b>{title}</b> milik <b>{store.name}</b> ({store.storeNo}) dihapus; periodenya tetap ada dan saldonya kembali penuh.</>}
          {' '}Tidak bisa dibatalkan dari aplikasi.
        </p>

        <div>
          <p className="text-xs font-semibold text-slate-600">
            {nothing ? 'Tidak ada data yang dihapus' : 'Yang akan dihapus'}
          </p>
          <ul className="mt-1.5 space-y-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            {lines.map((l) => (
              <li key={l.label} className="flex items-center justify-between gap-3">
                <span>
                  {l.label}
                  {l.hint && <span className="ml-1.5 text-[11px] text-slate-400">({l.hint})</span>}
                </span>
                <span className="font-bold tabular-nums">{n(l.count)}</span>
              </li>
            ))}
            {byStatus.length > 1 && (
              <li className="border-t border-slate-200 pt-1 text-[11px] text-slate-400">
                {byStatus.map((s) => `${s.label} ${n(s.count)}`).join(' · ')}
              </li>
            )}
          </ul>
        </div>

        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          <p className="font-semibold">Setelah reset</p>
          <p className="mt-0.5">
            {after.yearMonth
              ? scope.type === 'all'
                ? <>Satu periode <b>{periodLabel(after.yearMonth)}</b> dibuka dengan saldo {rp(after.balance ?? 0)}, tanpa request.</>
                : <>Periode <b>{periodLabel(after.yearMonth)}</b> ({after.status ? PERIOD_STATUS_LABEL[after.status].toLowerCase() : '—'}) kembali ke saldo {rp(after.balance ?? 0)}, tanpa request.</>
              : <>Toko berstatus {preview.store.status}: tidak ada periode baru dibuat (dibuat saat toko diaktifkan).</>}
          </p>
        </div>

        {preview.refillsVerified > 0 && (
          <Warning>
            <b>{n(preview.refillsVerified)} Refill sudah diverifikasi Finance</b> ({rp(preview.transferredAmount)} ditransfer
            {preview.refillsReceived > 0 && <>, {n(preview.refillsReceived)} sudah diterima toko</>}). Uangnya sudah keluar —
            catatannya hilang dari aplikasi setelah reset.
          </Warning>
        )}
        {preview.refillsInFlight > 0 && (
          <Warning>
            {n(preview.refillsInFlight)} Refill masih berjalan (OPS / Finance / foto bukti). Prosesnya ikut terhapus.
          </Warning>
        )}
        {unfinished > 0 && (
          <Warning>
            {n(unfinished)} request belum selesai (menunggu OPS atau konfirmasi nominal) ikut terhapus.
          </Warning>
        )}
        {preview.orphanedReRequests > 0 && (
          <Warning>
            {n(preview.orphanedReRequests)} Re-request di periode lain tetap ada, tetapi kehilangan tautan ke request asalnya.
          </Warning>
        )}

        {!nothing && (
          <a
            href={`/api/it/petty-cash-reset?${query(store.id, scope)}&backup=1`}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-cyan-700 underline-offset-2 hover:underline"
          >
            <Download className="h-3.5 w-3.5" /> Unduh cadangan data (JSON) sebelum reset
          </a>
        )}

        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-slate-600">
            Ketik <span className="font-mono text-rose-600">{store.storeNo}</span> untuk konfirmasi
          </p>
          <Input
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder={store.storeNo}
            disabled={busy}
            autoComplete="off"
          />
        </div>
      </div>
    );
  }

  return (
    <AlertDialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <AlertDialogContent className="max-w-lg rounded-2xl">
        <AlertDialogHeader className="flex-row items-start gap-3 text-left sm:flex">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-50 text-rose-600">
            <RotateCcw className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1 space-y-1.5">
            <AlertDialogTitle className="text-base font-bold text-slate-900">
              Reset {scope.type === 'all' ? 'semua periode' : `periode ${periodLabel(scope.yearMonth)}`} — {store.storeNo}?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="max-h-[60vh] overflow-y-auto text-sm text-slate-500">{body}</div>
            </AlertDialogDescription>
          </div>
        </AlertDialogHeader>

        {actionError && (
          <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">{actionError}</p>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Batal</AlertDialogCancel>
          {preview && (
            <Button
              type="button"
              onClick={handleReset}
              disabled={busy || !matches}
              className="gap-1.5 bg-rose-600 text-white hover:bg-rose-700"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Reset petty cash
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
