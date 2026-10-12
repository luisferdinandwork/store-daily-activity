'use client';
// components/ops/stores/StoreTaskResetDialog.tsx
//
// IT-only: reset today's TASK data of one store so the day can be redone from
// scratch (testing / a botched day). POST /api/it/stores/[id]/reset-tasks.
// Attendance, breaks and schedules stay. See lib/db/utils/store-task-reset.ts.

import { useState } from 'react';
import { Loader2, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';

import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import type { StoreRow } from '@/app/api/ops/stores/route';
import type { StoreTaskResetSummary } from '@/lib/db/utils/store-task-reset';

export default function StoreTaskResetDialog({
  store,
  onClose,
  onDone,
}: {
  store: StoreRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleReset() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/it/stores/${store.id}/reset-tasks`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data?.error ?? 'Failed to reset tasks.');
      const done = data as StoreTaskResetSummary;
      toast.success(`${done.storeName}: ${done.totalRemoved} task rows removed for ${done.day}${done.photos ? `, ${done.photos} photos deleted` : ''}.`);
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertDialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <AlertDialogContent className="max-w-md rounded-2xl">
        <AlertDialogHeader className="flex-row items-start gap-3 text-left sm:flex">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
            <RotateCcw className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1 space-y-1.5">
            <AlertDialogTitle className="text-base font-bold text-slate-900">Reset today&apos;s tasks of {store.name}?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-slate-500">
                <p>
                  Removes <span className="font-semibold text-slate-700">all task data of today</span> for{' '}
                  <span className="font-mono">{store.storeNo}</span> — opening, store front, setoran, cek bin, VM, marketing,
                  cek uang modal, briefing, serah terima, store closing (incl. EDC), grooming and cash counts — with their photos.
                </p>
                <p>
                  <span className="font-semibold text-slate-700">Kept:</span> attendance (check-in / out, breaks), schedules and
                  every other day. Staff stay checked in and the tasks start from zero.
                </p>
                <p className="font-medium text-amber-700">This cannot be undone.</p>
              </div>
            </AlertDialogDescription>
          </div>
        </AlertDialogHeader>

        {error && <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">{error}</p>}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <Button type="button" onClick={handleReset} disabled={busy} className="gap-1.5 bg-amber-600 text-white hover:bg-amber-700">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Reset today&apos;s tasks
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
