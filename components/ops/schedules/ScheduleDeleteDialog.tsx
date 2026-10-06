'use client';
// components/ops/schedules/ScheduleDeleteDialog.tsx
//
// Ops "Delete schedule" for one store-month, with two options:
//   • Keep attendance history — only entries without attendance go; a re-import
//     (Ops or PIC) can then fill the rest.
//   • Delete everything — every entry, attendance and task progress included;
//     Ops types the store code to confirm. Finance's money records stay.
// Loads a dry-run preview of both from /api/ops/schedules/monthly/deletion
// first. See deleteMonthlySchedule in lib/schedule-utils.ts.

import { useEffect, useState, type ReactNode } from 'react';
import { History, Loader2, Trash2, Wallet } from 'lucide-react';
import { toast } from 'sonner';

import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type {
  MonthlyScheduleDeletionPreview,
  MonthlyScheduleDeletionSummary,
  ScheduleDeleteMode,
  ScheduleRecordCount,
} from '@/lib/schedule-utils';

const n = (count: number) => count.toLocaleString('id-ID');
const plural = (count: number, word: string) => `${n(count)} ${word}${count !== 1 ? 's' : ''}`;
const entries = (count: number) => `${n(count)} ${count !== 1 ? 'entries' : 'entry'}`;

function CountList({ items }: { items: ScheduleRecordCount[] }) {
  return (
    <ul className="mt-1.5 space-y-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
      {items.map((r) => (
        <li key={r.table} className="flex items-center justify-between gap-3">
          <span className="first-letter:uppercase">{r.label}</span>
          <span className="font-bold tabular-nums">{n(r.count)}</span>
        </li>
      ))}
    </ul>
  );
}

function OptionCard({ active, tone, icon, title, onSelect, children }: {
  active: boolean;
  tone: 'indigo' | 'rose';
  icon: ReactNode;
  title: string;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onSelect}
      className={cn(
        'w-full rounded-xl border-2 px-3.5 py-3 text-left transition-colors',
        active
          ? tone === 'rose' ? 'border-rose-400 bg-rose-50/60' : 'border-indigo-400 bg-indigo-50/60'
          : 'border-slate-200 bg-white hover:border-slate-300',
      )}
    >
      <span className="flex items-center gap-2">
        <span
          className={cn(
            'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2',
            active ? (tone === 'rose' ? 'border-rose-500' : 'border-indigo-500') : 'border-slate-300',
          )}
        >
          {active && <span className={cn('h-2 w-2 rounded-full', tone === 'rose' ? 'bg-rose-500' : 'bg-indigo-500')} />}
        </span>
        <span className={cn('shrink-0', tone === 'rose' ? 'text-rose-600' : 'text-indigo-600')}>{icon}</span>
        <span className="text-sm font-bold text-slate-800">{title}</span>
      </span>
      <span className="mt-1.5 block space-y-1.5 pl-6 text-xs leading-relaxed text-slate-500">{children}</span>
    </button>
  );
}

export default function ScheduleDeleteDialog({
  storeId,
  storeNo,
  storeName,
  yearMonth,
  monthLabel,
  onClose,
  onDeleted,
}: {
  storeId: string;
  storeNo: string;
  storeName: string;
  yearMonth: string;
  /** e.g. "October 2026". */
  monthLabel: string;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [preview, setPreview] = useState<MonthlyScheduleDeletionPreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [mode, setMode] = useState<ScheduleDeleteMode>('keep_history');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ storeId, yearMonth });
    fetch(`/api/ops/schedules/monthly/deletion?${params}`, { cache: 'no-store' })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data?.error ?? 'Failed to check this schedule.');
        if (!cancelled) setPreview(data.preview as MonthlyScheduleDeletionPreview);
      })
      .catch((err) => { if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err)); });
    return () => { cancelled = true; };
  }, [storeId, yearMonth]);

  async function handleDelete() {
    setBusy(true);
    setActionError(null);
    try {
      const params = new URLSearchParams({ storeId, yearMonth, mode });
      if (mode === 'all') params.set('confirm', confirm.trim());
      const res = await fetch(`/api/ops/schedules/monthly?${params}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data?.error ?? 'Failed to delete the schedule.');
      const done = data.summary as MonthlyScheduleDeletionSummary;
      toast.success(
        done.monthRemoved
          ? `${monthLabel} schedule deleted — ${entries(done.removedDays)} removed`
          : `Schedule cleared — ${entries(done.keptDays)} with attendance kept`,
      );
      onDeleted();
      onClose();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to delete the schedule.');
    } finally {
      setBusy(false);
    }
  }

  const matches = confirm.trim().toUpperCase() === storeNo.toUpperCase();

  let body: ReactNode;
  if (loadError) {
    body = <p className="text-rose-600">{loadError}</p>;
  } else if (!preview) {
    body = (
      <p className="flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Checking this schedule&apos;s records…
      </p>
    );
  } else {
    const keep = preview.keep_history;
    const all = preview.all;
    body = (
      <div className="space-y-3" role="radiogroup" aria-label="Delete option">
        <p>
          {storeName} · {entries(all.removedDays)} (one per employee per day).
        </p>

        <OptionCard
          active={mode === 'keep_history'}
          tone="indigo"
          icon={<History className="h-4 w-4" />}
          title="Keep attendance history"
          onSelect={() => setMode('keep_history')}
        >
          {keep.keptDays > 0 ? (
            <>
              <span className="block">
                Removes the {entries(keep.removedDays)} that have no attendance yet — shifts, days off, leave.
              </span>
              <span className="block">
                Keeps the <b className="text-slate-700">{entries(keep.keptDays)}</b> where attendance is already
                recorded (check-ins, absences, Cuti / Sakit), with their tasks. A re-import — by Ops or the
                PIC — fills in every other day.
              </span>
            </>
          ) : (
            <span className="block">
              No attendance is recorded yet, so all {entries(keep.removedDays)} are removed and the month is gone.
            </span>
          )}
        </OptionCard>

        <OptionCard
          active={mode === 'all'}
          tone="rose"
          icon={<Trash2 className="h-4 w-4" />}
          title="Delete everything, including history"
          onSelect={() => setMode('all')}
        >
          <span className="block">
            Removes all {entries(all.removedDays)} and everything recorded on them. This can&apos;t be undone.
          </span>
          {all.removed.length > 0 && <CountList items={all.removed} />}
          {all.photos > 0 && <span className="block">{plural(all.photos, 'task photo')} are deleted too.</span>}
        </OptionCard>

        {mode === 'all' && (
          <>
            {all.keptFinance.length > 0 && (
              <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
                <Wallet className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p>Kept for Finance — these money records stay, no longer linked to a day:</p>
                  <ul className="mt-1 space-y-0.5">
                    {all.keptFinance.map((r) => (
                      <li key={r.table} className="flex items-center justify-between gap-3">
                        <span className="first-letter:uppercase">{r.label}</span>
                        <span className="font-bold tabular-nums">{n(r.count)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-slate-600">
                Type <span className="font-mono text-rose-600">{storeNo}</span> to confirm
              </p>
              <Input
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder={storeNo}
                disabled={busy}
                autoComplete="off"
              />
            </div>
          </>
        )}
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
            <AlertDialogTitle className="text-base font-bold text-slate-900">Delete the {monthLabel} schedule?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="max-h-[65vh] overflow-y-auto text-sm text-slate-500">{body}</div>
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
              disabled={busy || (mode === 'all' && !matches)}
              className={cn(
                'gap-1.5 text-white',
                mode === 'all' ? 'bg-rose-600 hover:bg-rose-700' : 'bg-indigo-600 hover:bg-indigo-700',
              )}
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {mode === 'all' ? 'Delete everything' : 'Delete, keep history'}
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
