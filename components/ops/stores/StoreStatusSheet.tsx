'use client';
// components/ops/stores/StoreStatusSheet.tsx
//
// IT-only: move a store through its lifecycle (ready_to_open → active → close,
// close → active). See lib/store-status.ts for what each status means; the
// server (lib/db/utils/store-status.ts) re-validates the transition and does
// the petty-cash provisioning on activation.

import { useState } from 'react';
import { AlertTriangle, Loader2, Power } from 'lucide-react';
import { toast } from 'sonner';

import { Sheet, SheetContent, SheetTitle, SheetDescription, SheetHeader, SheetFooter } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type { StoreRow } from '@/app/api/ops/stores/route';
import {
  STORE_STATUS_BADGE,
  STORE_STATUS_LABEL,
  STORE_STATUS_TRANSITIONS,
  type StoreStatus,
} from '@/lib/store-status';

const EFFECT: Record<StoreStatus, string> = {
  active:
    'The store starts recording attendance and tasks. Coming from Ready to Open, its petty cash is provisioned (Rp 1.000.000) and it appears in Finance.',
  close:
    'Attendance, tasks and petty cash stop being recorded. The petty cash balance is kept as-is for the Audit close-out.',
  ready_to_open: '',
};

export default function StoreStatusSheet({
  store,
  onClose,
  onSaved,
}: {
  store: StoreRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const options = STORE_STATUS_TRANSITIONS[store.status];
  const [target, setTarget] = useState<StoreStatus | null>(options.length === 1 ? options[0] : null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit() {
    if (!target) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/ops/stores/${store.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: target, statusNote: note.trim() || null }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data?.error ?? 'Failed to change status.');
      toast.success(`${store.storeNo} is now ${STORE_STATUS_LABEL[target]}.`);
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to change status.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Power className="h-4 w-4 text-indigo-500" />
            Store status — {store.storeNo}
          </SheetTitle>
          <SheetDescription>
            {store.name} is currently{' '}
            <span className={cn('rounded-md px-1.5 py-0.5 text-[10px] font-bold ring-1 ring-inset', STORE_STATUS_BADGE[store.status])}>
              {STORE_STATUS_LABEL[store.status]}
            </span>
            .
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-5 overflow-y-auto px-4 pb-4">
          <div className="space-y-2">
            <Label>Change to</Label>
            <div className="space-y-2">
              {options.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setTarget(s)}
                  disabled={saving}
                  className={cn(
                    'w-full rounded-xl border px-3 py-2.5 text-left transition-colors',
                    target === s ? 'border-indigo-400 bg-indigo-50/60' : 'border-slate-200 hover:bg-slate-50',
                  )}
                >
                  <span className={cn('inline-flex rounded-md px-2 py-0.5 text-[10px] font-bold ring-1 ring-inset', STORE_STATUS_BADGE[s])}>
                    {STORE_STATUS_LABEL[s]}
                  </span>
                  <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">{EFFECT[s]}</p>
                </button>
              ))}
            </div>
          </div>

          {target === 'close' && (
            <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <p>Closing a store is recorded in its status history. Audit sign-off will be required here in a later phase.</p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="statusNote">Note (optional)</Label>
            <Textarea
              id="statusNote"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={target === 'close' ? 'Reason for closing…' : 'e.g. grand opening 1 Oct'}
              rows={3}
              disabled={saving}
            />
          </div>
        </div>

        <SheetFooter className="flex-row gap-2 border-t border-border">
          <Button type="button" variant="outline" onClick={onClose} disabled={saving} className="flex-1">
            Cancel
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={saving || !target} className="flex-1 gap-1.5">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {target ? `Set ${STORE_STATUS_LABEL[target]}` : 'Choose a status'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
