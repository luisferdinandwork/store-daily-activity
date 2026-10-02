'use client';
// components/ops/stores/StoreDeleteDialog.tsx
//
// IT-only: permanently delete a (non-active) store. Loads a dry-run preview from
// /api/it/stores/[id]/deletion, then asks IT to type the store code before
// DELETE /api/it/stores/[id] goes through. See lib/db/utils/store-deletion.ts.

import { useEffect, useState, type ReactNode } from 'react';
import { Loader2, Trash2, Users } from 'lucide-react';
import { toast } from 'sonner';

import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { StoreRow } from '@/app/api/ops/stores/route';
import type { StoreDeletionSummary } from '@/lib/db/utils/store-deletion';

export default function StoreDeleteDialog({
  store,
  onClose,
  onDeleted,
}: {
  store: StoreRow;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [preview, setPreview] = useState<StoreDeletionSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/it/stores/${store.id}/deletion`, { cache: 'no-store' })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data?.error ?? 'Failed to check this store.');
        if (!cancelled) setPreview(data as StoreDeletionSummary);
      })
      .catch((err) => { if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err)); });
    return () => { cancelled = true; };
  }, [store.id]);

  async function handleDelete() {
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/it/stores/${store.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmStoreNo: confirm }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data?.error ?? 'Failed to delete store.');
      const done = data as StoreDeletionSummary;
      toast.success(
        `${store.storeNo} deleted.`
        + (done.unassignedEmployees > 0
          ? ` ${done.unassignedEmployees} employee${done.unassignedEmployees !== 1 ? 's' : ''} now have no store.`
          : ''),
      );
      onDeleted();
      onClose();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to delete store.');
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
        <Loader2 className="h-4 w-4 animate-spin" /> Checking this store&apos;s records…
      </p>
    );
  } else {
    const shown = preview.removed.slice(0, 8);
    const more = preview.removed.slice(shown.length).reduce((n, r) => n + r.count, 0);
    body = (
      <div className="space-y-3">
        <p>
          {store.name} ({store.storeNo}) and all of its history are removed for good — schedules, attendance, tasks,
          petty cash, setoran, targets and status history. This can&apos;t be undone.
        </p>

        <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
          <Users className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <p>
            {preview.unassignedEmployees > 0
              ? `${preview.unassignedEmployees} employee${preview.unassignedEmployees !== 1 ? 's' : ''} assigned here keep their account but end up with no store — assign them a new store in Users.`
              : 'No employees are assigned to this store.'}
          </p>
        </div>

        {shown.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-slate-600">
              {preview.totalRemoved.toLocaleString('id-ID')} records will be deleted
              {preview.photos > 0 && <> · {preview.photos.toLocaleString('id-ID')} photos</>}
            </p>
            <ul className="mt-1.5 space-y-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              {shown.map((r) => (
                <li key={r.table} className="flex items-center justify-between gap-3">
                  <span className="first-letter:uppercase">{r.label}</span>
                  <span className="font-bold tabular-nums">{r.count.toLocaleString('id-ID')}</span>
                </li>
              ))}
              {more > 0 && <li className="text-[11px] opacity-70">+ {more.toLocaleString('id-ID')} more</li>}
            </ul>
          </div>
        )}

        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-slate-600">
            Type <span className="font-mono text-rose-600">{store.storeNo}</span> to confirm
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
      <AlertDialogContent className="max-w-md rounded-2xl">
        <AlertDialogHeader className="flex-row items-start gap-3 text-left sm:flex">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-50 text-rose-600">
            <Trash2 className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1 space-y-1.5">
            <AlertDialogTitle className="text-base font-bold text-slate-900">Delete {store.name}?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="max-h-[60vh] overflow-y-auto text-sm text-slate-500">{body}</div>
            </AlertDialogDescription>
          </div>
        </AlertDialogHeader>

        {actionError && (
          <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">{actionError}</p>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          {preview && (
            <Button
              type="button"
              onClick={handleDelete}
              disabled={busy || !matches}
              className="gap-1.5 bg-rose-600 text-white hover:bg-rose-700"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Delete store
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
