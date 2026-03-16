// components/employee/StoreOpeningTaskDetail.tsx
'use client';

import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import {
  ArrowLeft, Store, CheckCircle2, Circle, Camera,
  X, Loader2, ImagePlus, ChevronRight, AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { StoreOpeningTask } from '@/app/employee/tasks/page';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  task: StoreOpeningTask;
  onBack: () => void;
}

interface ChecklistState {
  allLightsOn:      boolean;
  cleanlinessCheck: boolean;
  equipmentCheck:   boolean;
  stockCheck:       boolean;
  safetyCheck:      boolean;
}

// ─── Config ───────────────────────────────────────────────────────────────────

const CHECKLIST_ITEMS: { key: keyof ChecklistState; label: string; hint: string }[] = [
  { key: 'allLightsOn',      label: 'Lights & Signage',   hint: 'All lights, neon signs, and display lighting switched on' },
  { key: 'cleanlinessCheck', label: 'Cleanliness',        hint: 'Floor, counters, and restroom inspected and clean' },
  { key: 'equipmentCheck',   label: 'Equipment',          hint: 'POS, coffee machine, fridge, and scales operational' },
  { key: 'stockCheck',       label: 'Stock Levels',       hint: 'Critical items stocked and within expiry' },
  { key: 'safetyCheck',      label: 'Safety',             hint: 'Fire exits clear, first-aid kit present and stocked' },
];

const PHOTO_LIMITS = { store_front: 3, cash_drawer: 2 };

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
      {children}
    </p>
  );
}

function PhotoUploadStrip({
  label,
  photoType,
  photos,
  maxAllowed,
  onAdd,
  onRemove,
  disabled,
}: {
  label: string;
  photoType: 'store_front' | 'cash_drawer';
  photos: string[];
  maxAllowed: number;
  onAdd: (url: string) => void;
  onRemove: (idx: number) => void;
  disabled: boolean;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    setError(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('photoType', photoType);
      const res  = await fetch('/api/employee/tasks/upload', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Upload failed');
      onAdd(data.url);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setUploading(false);
    }
  };

  const canAdd = photos.length < maxAllowed && !disabled;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <SectionLabel>{label}</SectionLabel>
        <span className="text-[10px] text-muted-foreground">{photos.length}/{maxAllowed}</span>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {/* Existing photos */}
        {photos.map((url, i) => (
          <div key={i} className="relative h-20 w-20 flex-shrink-0 overflow-hidden rounded-xl border border-border">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={`photo-${i}`} className="h-full w-full object-cover" />
            {!disabled && (
              <button
                type="button"
                onClick={() => onRemove(i)}
                className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        ))}

        {/* Add button */}
        {canAdd && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="flex h-20 w-20 flex-shrink-0 flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-border bg-secondary text-muted-foreground transition-colors hover:border-primary hover:text-primary"
          >
            {uploading
              ? <Loader2 className="h-5 w-5 animate-spin" />
              : <><ImagePlus className="h-5 w-5" /><span className="text-[10px]">Add</span></>
            }
          </button>
        )}
      </div>

      {error && (
        <p className="flex items-center gap-1 text-[11px] text-destructive">
          <AlertCircle className="h-3 w-3" /> {error}
        </p>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = '';
        }}
      />
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function StoreOpeningTaskDetail({ task, onBack }: Props) {
  const isReadOnly = task.status === 'completed';

  // Form state — pre-fill if editing a partially-started task
  const [cash, setCash] = useState<string>(task.cashDrawerAmount?.toString() ?? '');
  const [checks, setChecks] = useState<ChecklistState>({
    allLightsOn:      task.allLightsOn      ?? false,
    cleanlinessCheck: task.cleanlinessCheck ?? false,
    equipmentCheck:   task.equipmentCheck   ?? false,
    stockCheck:       task.stockCheck       ?? false,
    safetyCheck:      task.safetyCheck      ?? false,
  });
  const [notes, setNotes]               = useState(task.openingNotes ?? '');
  const [storeFront, setStoreFront]     = useState<string[]>(task.storeFrontPhotos ?? []);
  const [cashDrawer, setCashDrawer]     = useState<string[]>(task.cashDrawerPhotos ?? []);
  const [submitting, setSubmitting]     = useState(false);
  const [error, setError]               = useState<string | null>(null);

  const toggleCheck = (key: keyof ChecklistState) => {
    if (isReadOnly) return;
    setChecks((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const allChecksPassed = Object.values(checks).every(Boolean);
  const canSubmit =
    !isReadOnly &&
    cash.trim() !== '' &&
    Number(cash) >= 0 &&
    allChecksPassed &&
    storeFront.length >= PHOTO_LIMITS.store_front - 2 && // min 1
    cashDrawer.length >= 1;

  const handleSubmit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/employee/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskType:         'store_opening',
          taskId:           task.id,
          cashDrawerAmount: Number(cash),
          ...checks,
          openingNotes:     notes || null,
          storeFrontPhotos: storeFront,
          cashDrawerPhotos: cashDrawer,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to submit');
      onBack();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const completedChecks = Object.values(checks).filter(Boolean).length;
  const progress = Math.round(
    ((completedChecks / 5) * 0.4 +
     (cash ? 0.15 : 0) +
     (storeFront.length >= 1 ? 0.25 : storeFront.length > 0 ? 0.1 : 0) +
     (cashDrawer.length >= 1 ? 0.2 : cashDrawer.length > 0 ? 0.1 : 0)) * 100
  );

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* ── Header ── */}
      <div className="relative overflow-hidden bg-primary px-6 pb-8 pt-10">
        <div className="pointer-events-none absolute -right-8 -top-8 h-36 w-36 rounded-full bg-white/5" />
        <div className="pointer-events-none absolute -bottom-4 left-8 h-20 w-20 rounded-full bg-white/5" />

        <button
          onClick={onBack}
          className="mb-4 flex items-center gap-1.5 text-xs font-medium text-primary-foreground/70 transition-opacity hover:text-primary-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to tasks
        </button>

        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-white/15">
            <Store className="h-5 w-5 text-primary-foreground" />
          </div>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-primary-foreground">Store Opening</h1>
            <p className="mt-0.5 text-xs text-primary-foreground/60">
              {new Date(task.date).toLocaleDateString('en-ID', {
                weekday: 'long', day: 'numeric', month: 'long',
              })} · Morning shift
            </p>
          </div>
          {isReadOnly && (
            <Badge className="bg-green-500/20 text-green-100 hover:bg-green-500/20">
              <CheckCircle2 className="mr-1 h-3 w-3" /> Done
            </Badge>
          )}
        </div>

        {/* Progress bar */}
        <div className="mt-4">
          <div className="flex items-center justify-between text-[10px] text-primary-foreground/60">
            <span>Progress</span>
            <span>{isReadOnly ? 100 : progress}%</span>
          </div>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/20">
            <div
              className="h-full rounded-full bg-white transition-all duration-500"
              style={{ width: `${isReadOnly ? 100 : progress}%` }}
            />
          </div>
        </div>
      </div>

      {/* ── Scrollable content ── */}
      <div className="flex-1 space-y-5 overflow-y-auto p-4 pb-32">

        {/* Cash drawer amount */}
        <div className="rounded-2xl border border-border bg-card p-4">
          <SectionLabel>Opening Cash Float (IDR)</SectionLabel>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground">
              Rp
            </span>
            <Input
              type="number"
              min={0}
              value={cash}
              onChange={(e) => { if (!isReadOnly) setCash(e.target.value); }}
              readOnly={isReadOnly}
              placeholder="500000"
              className="pl-9 text-sm font-semibold"
            />
          </div>
        </div>

        {/* Checklist */}
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <SectionLabel>Opening Checklist</SectionLabel>
            <span className="text-[10px] font-bold text-primary">
              {completedChecks}/{CHECKLIST_ITEMS.length}
            </span>
          </div>

          <div className="space-y-1">
            {CHECKLIST_ITEMS.map(({ key, label, hint }) => {
              const checked = checks[key];
              return (
                <button
                  key={key}
                  type="button"
                  disabled={isReadOnly}
                  onClick={() => toggleCheck(key)}
                  className={cn(
                    'flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition-colors',
                    checked ? 'bg-green-50 dark:bg-green-950/20' : 'bg-secondary hover:bg-border',
                    isReadOnly && 'cursor-default',
                  )}
                >
                  <div className={cn(
                    'mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2 transition-colors',
                    checked
                      ? 'border-green-500 bg-green-500'
                      : 'border-muted-foreground/40 bg-background',
                  )}>
                    {checked && <CheckCircle2 className="h-3 w-3 text-white" strokeWidth={3} />}
                  </div>
                  <div className="flex-1">
                    <p className={cn(
                      'text-sm font-semibold leading-tight',
                      checked ? 'text-green-700 dark:text-green-400' : 'text-foreground',
                    )}>
                      {label}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Photos */}
        <div className="rounded-2xl border border-border bg-card p-4 space-y-4">
          <div className="flex items-center gap-2">
            <Camera className="h-4 w-4 text-muted-foreground" />
            <SectionLabel>Required Photos</SectionLabel>
          </div>

          <PhotoUploadStrip
            label="Store Front (min 1, max 3)"
            photoType="store_front"
            photos={storeFront}
            maxAllowed={PHOTO_LIMITS.store_front}
            onAdd={(url) => setStoreFront((p) => [...p, url])}
            onRemove={(i) => setStoreFront((p) => p.filter((_, idx) => idx !== i))}
            disabled={isReadOnly}
          />

          <div className="border-t border-border" />

          <PhotoUploadStrip
            label="Cash Drawer (min 1, max 2)"
            photoType="cash_drawer"
            photos={cashDrawer}
            maxAllowed={PHOTO_LIMITS.cash_drawer}
            onAdd={(url) => setCashDrawer((p) => [...p, url])}
            onRemove={(i) => setCashDrawer((p) => p.filter((_, idx) => idx !== i))}
            disabled={isReadOnly}
          />
        </div>

        {/* Notes */}
        <div className="rounded-2xl border border-border bg-card p-4">
          <SectionLabel>Opening Notes (optional)</SectionLabel>
          <Textarea
            value={notes}
            onChange={(e) => { if (!isReadOnly) setNotes(e.target.value); }}
            readOnly={isReadOnly}
            placeholder="Any issues or remarks for this opening…"
            rows={3}
            className="resize-none text-sm"
          />
        </div>

        {/* Completion info (read-only) */}
        {isReadOnly && task.completedAt && (
          <div className="flex items-center gap-2 rounded-xl bg-green-50 dark:bg-green-950/20 px-4 py-3">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <p className="text-xs text-green-700 dark:text-green-400">
              Completed at{' '}
              {new Date(task.completedAt).toLocaleTimeString('en-ID', {
                hour: '2-digit', minute: '2-digit',
              })}
            </p>
          </div>
        )}
      </div>

      {/* ── Sticky submit ── */}
      {!isReadOnly && (
        <div className="fixed bottom-0 left-0 right-0 border-t border-border bg-card/95 p-4 backdrop-blur-sm">
          {error && (
            <p className="mb-3 flex items-center gap-1.5 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" /> {error}
            </p>
          )}
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit || submitting}
            className="h-12 w-full gap-2 rounded-xl text-sm font-bold"
          >
            {submitting ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Submitting…</>
            ) : (
              <><CheckCircle2 className="h-4 w-4" /> Submit Opening Checklist</>
            )}
          </Button>
          {!canSubmit && !submitting && (
            <p className="mt-2 text-center text-[10px] text-muted-foreground">
              {!allChecksPassed && 'Complete all checklist items · '}
              {!cash && 'Enter cash amount · '}
              {storeFront.length < 1 && 'Add store-front photo · '}
              {cashDrawer.length < 1 && 'Add cash drawer photo'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}