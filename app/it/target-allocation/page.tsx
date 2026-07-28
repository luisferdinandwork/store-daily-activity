'use client';
// app/it/target-allocation/page.tsx — IT-only editor for the default
// PIC1/PIC2/SA1-5 × "Man Power" percentage grid (target_allocation_templates).
// This is where the defaults Ops's monthly roster percentages come from
// live — Ops can still override a single employee's % per store/month, but
// this page controls the starting point for every store.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Info, Loader2, Plus, Shield, Trash2, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

// ─── Types ────────────────────────────────────────────────────────────────────

interface TemplateCell {
  id: number;
  headcount: number;
  slotCode: string; // PIC1 | PIC2 | SA1 | SA2 | ...
  percentage: number;
}

const PIC_ROWS = ['PIC1', 'PIC2'];

function slotSortKey(slotCode: string) {
  if (slotCode === 'PIC1') return 0;
  if (slotCode === 'PIC2') return 1;
  const n = Number(slotCode.replace('SA', ''));
  return 100 + (Number.isFinite(n) ? n : 0);
}

export default function TargetAllocationPage() {
  const { data: session, status: authStatus } = useSession();
  const router = useRouter();
  const role = (session?.user as any)?.role as string | undefined;
  const isIt = role === 'it';

  const [cells, setCells] = useState<TemplateCell[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [newHeadcountInput, setNewHeadcountInput] = useState('');

  useEffect(() => {
    if (authStatus === 'loading') return;
    if (!session) { router.replace('/login'); return; }
    if (!isIt)    router.replace('/');
  }, [authStatus, session, isIt, router]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/it/target-allocation-templates', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data?.error ?? 'Failed to load templates.');
      setCells(data.templates ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load templates.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (isIt) load(); }, [isIt, load]);

  const headcounts = useMemo(
    () => [...new Set(cells.map((c) => c.headcount))].sort((a, b) => a - b),
    [cells],
  );

  const slotCodes = useMemo(() => {
    const sas = new Set<string>();
    for (const c of cells) {
      if (!PIC_ROWS.includes(c.slotCode)) sas.add(c.slotCode);
    }
    return [...PIC_ROWS, ...[...sas].sort((a, b) => slotSortKey(a) - slotSortKey(b))];
  }, [cells]);

  const cellByKey = useMemo(() => {
    const map = new Map<string, TemplateCell>();
    for (const c of cells) map.set(`${c.headcount}:${c.slotCode}`, c);
    return map;
  }, [cells]);

  const columnTotal = useCallback(
    (headcount: number) =>
      cells
        .filter((c) => c.headcount === headcount)
        .reduce((sum, c) => sum + c.percentage, 0),
    [cells],
  );

  async function saveCell(headcount: number, slotCode: string, percentage: number) {
    const key = `${headcount}:${slotCode}`;
    setSaving((prev) => new Set(prev).add(key));
    try {
      const res = await fetch('/api/it/target-allocation-templates', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ headcount, slotCode, percentage }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data?.error ?? 'Failed to save.');

      setCells((prev) => {
        const next = prev.filter((c) => !(c.headcount === headcount && c.slotCode === slotCode));
        next.push(data.template);
        return next;
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save.');
    } finally {
      setSaving((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }

  async function deleteCell(headcount: number, slotCode: string) {
    const key = `${headcount}:${slotCode}`;
    setSaving((prev) => new Set(prev).add(key));
    try {
      const res = await fetch(
        `/api/it/target-allocation-templates?headcount=${headcount}&slotCode=${slotCode}`,
        { method: 'DELETE' },
      );
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data?.error ?? 'Failed to delete.');

      setCells((prev) => prev.filter((c) => !(c.headcount === headcount && c.slotCode === slotCode)));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete.');
    } finally {
      setSaving((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }

  const parsedHeadcount = Math.round(Number(newHeadcountInput));
  const headcountError =
    newHeadcountInput.trim() === ''
      ? null
      : !Number.isInteger(parsedHeadcount) || parsedHeadcount < 1 || parsedHeadcount > 30
        ? 'Enter a whole number between 1 and 30.'
        : headcounts.includes(parsedHeadcount)
          ? `${parsedHeadcount} orang already exists — edit it directly in the table.`
          : null;
  const canSubmitHeadcount = newHeadcountInput.trim() !== '' && !headcountError;
  const previewShare =
    canSubmitHeadcount ? Math.round((100 / parsedHeadcount) * 100) / 100 : null;

  function closeAddDialog() {
    setAddDialogOpen(false);
    setNewHeadcountInput('');
  }

  async function submitAddHeadcountColumn() {
    if (!canSubmitHeadcount) return;
    const headcount = parsedHeadcount;

    setAddSubmitting(true);
    try {
      // Seed PIC1 + PIC2 + (headcount - 2) SA slots with an equal split as a starting point.
      const saCount = Math.max(0, headcount - 2);
      const share = Math.round((100 / headcount) * 100) / 100;
      const slots = [
        ...PIC_ROWS,
        ...Array.from({ length: saCount }, (_, i) => `SA${i + 1}`),
      ];

      for (const slotCode of slots) {
        await saveCell(headcount, slotCode, share);
      }

      toast.success(`Added the ${headcount} orang column.`);
      closeAddDialog();
    } finally {
      setAddSubmitting(false);
    }
  }

  function addSaRow() {
    const existingSaNumbers = slotCodes
      .filter((s) => s.startsWith('SA'))
      .map((s) => Number(s.replace('SA', '')));
    const next = (existingSaNumbers.length > 0 ? Math.max(...existingSaNumbers) : 0) + 1;
    const slotCode = `SA${next}`;
    const headcount = headcounts[headcounts.length - 1];
    if (headcount == null) {
      toast.error('Add a headcount column first.');
      return;
    }
    saveCell(headcount, slotCode, 0);
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
      <p className="text-sm text-slate-500">Only IT can manage performance target defaults.</p>
    </div>
  );

  return (
    <div className="min-h-full bg-slate-50">
      <div className="border-b border-slate-200 bg-white px-6 py-5 lg:px-8">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-cyan-600">IT · Settings</p>
            <h1 className="text-xl font-bold text-slate-900">Performance Target Defaults</h1>
            <p className="mt-0.5 text-xs text-slate-400">
              Default PIC1/PIC2/SA split by store headcount (&quot;Man Power&quot;). Ops uses this as the
              starting point for each store&apos;s monthly percentages.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={addSaRow} className="gap-1.5">
              <Plus className="h-4 w-4" />
              SA row
            </Button>
            <Button onClick={() => setAddDialogOpen(true)} className="gap-1.5 bg-cyan-600 hover:bg-cyan-700">
              <Plus className="h-4 w-4" />
              Headcount column
            </Button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl space-y-4 p-6 lg:p-8">
        {loading ? (
          <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-cyan-400" /></div>
        ) : headcounts.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-slate-200 bg-white py-16 text-center">
            <p className="text-sm font-semibold text-slate-600">No default grid configured yet.</p>
            <p className="text-xs text-slate-400">Add a headcount column to get started.</p>
            <Button onClick={() => setAddDialogOpen(true)} className="mt-1 gap-1.5 bg-cyan-600 hover:bg-cyan-700">
              <Plus className="h-4 w-4" />
              Add headcount column
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="sticky left-0 z-10 bg-slate-50 px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
                    Level
                  </th>
                  {headcounts.map((hc) => (
                    <th key={hc} className="min-w-[110px] px-3 py-3 text-center text-xs font-bold uppercase tracking-wide text-slate-500">
                      {hc} orang
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {slotCodes.map((slotCode) => (
                  <tr key={slotCode} className="border-b border-slate-100 last:border-0">
                    <td className="sticky left-0 z-10 bg-white px-4 py-2 text-sm font-semibold text-slate-700">
                      {slotCode}
                    </td>
                    {headcounts.map((hc) => {
                      const cell = cellByKey.get(`${hc}:${slotCode}`);
                      const key = `${hc}:${slotCode}`;
                      const isSaving = saving.has(key);
                      return (
                        <td key={hc} className="px-2 py-2">
                          {cell ? (
                            <div className="flex items-center gap-1">
                              <div className="relative">
                                <Input
                                  type="number"
                                  step="0.1"
                                  defaultValue={cell.percentage}
                                  disabled={isSaving}
                                  onBlur={(e) => {
                                    const val = Number(e.target.value);
                                    if (Number.isFinite(val) && val !== cell.percentage) {
                                      saveCell(hc, slotCode, val);
                                    }
                                  }}
                                  className="h-8 w-20 text-right text-xs"
                                />
                              </div>
                              <button
                                onClick={() => deleteCell(hc, slotCode)}
                                disabled={isSaving}
                                title="Remove this cell"
                                className="text-slate-300 hover:text-red-500 disabled:opacity-40"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => saveCell(hc, slotCode, 0)}
                              className="h-8 w-20 rounded-md border border-dashed border-slate-200 text-xs text-slate-300 hover:border-cyan-300 hover:text-cyan-500"
                            >
                              + add
                            </button>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-200 bg-slate-50">
                  <td className="sticky left-0 z-10 bg-slate-50 px-4 py-2 text-xs font-bold uppercase tracking-wide text-slate-500">
                    Total
                  </td>
                  {headcounts.map((hc) => {
                    const total = Math.round(columnTotal(hc) * 100) / 100;
                    const ok = Math.abs(total - 100) < 0.05;
                    return (
                      <td key={hc} className="px-3 py-2 text-center">
                        <span
                          className={cn(
                            'inline-block rounded-full px-2 py-0.5 text-xs font-bold',
                            ok ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600',
                          )}
                        >
                          {total.toFixed(1)}%
                        </span>
                      </td>
                    );
                  })}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      <Dialog open={addDialogOpen} onOpenChange={(open) => (open ? setAddDialogOpen(true) : closeAddDialog())}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="h-4 w-4 text-cyan-600" />
              Add a headcount column
            </DialogTitle>
            <DialogDescription>
              New Man Power size to configure. It starts as an equal split across PIC1, PIC2, and every SA
              slot — tweak individual percentages in the table afterward.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="new-headcount">Man Power (headcount)</Label>
            <Input
              id="new-headcount"
              type="number"
              min={1}
              max={30}
              placeholder="e.g. 14"
              value={newHeadcountInput}
              onChange={(e) => setNewHeadcountInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canSubmitHeadcount && !addSubmitting) {
                  void submitAddHeadcountColumn();
                }
              }}
              autoFocus
            />
            {headcountError ? (
              <p className="text-xs font-medium text-red-500">{headcountError}</p>
            ) : previewShare != null ? (
              <p className="flex items-center gap-1.5 text-xs text-slate-500">
                <Info className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                Will create {parsedHeadcount} slots (PIC1, PIC2, SA1-{Math.max(0, parsedHeadcount - 2)}) at{' '}
                <span className="font-semibold text-slate-700">{previewShare}%</span> each.
              </p>
            ) : (
              <p className="text-xs text-slate-400">Existing columns: {headcounts.join(', ') || 'none yet'}.</p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeAddDialog} disabled={addSubmitting}>
              Cancel
            </Button>
            <Button
              onClick={() => submitAddHeadcountColumn()}
              disabled={!canSubmitHeadcount || addSubmitting}
              className="gap-1.5 bg-cyan-600 hover:bg-cyan-700"
            >
              {addSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Add column
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
