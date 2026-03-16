// components/employee/GroomingTaskDetail.tsx
'use client';

import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  ArrowLeft, User, CheckCircle2, Camera,
  X, Loader2, ImagePlus, AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { GroomingTask } from '@/app/employee/tasks/page';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  task: GroomingTask;
  onBack: () => void;
}

interface ChecklistState {
  uniformComplete:      boolean;
  hairGroomed:          boolean;
  nailsClean:           boolean;
  accessoriesCompliant: boolean;
  shoeCompliant:        boolean;
}

// ─── Config ───────────────────────────────────────────────────────────────────

const CHECKLIST_ITEMS: {
  key: keyof ChecklistState;
  label: string;
  hint: string;
  emoji: string;
}[] = [
  { key: 'uniformComplete',      emoji: '👔', label: 'Full Uniform',    hint: 'Shirt, apron, and name tag all worn correctly' },
  { key: 'hairGroomed',          emoji: '💇', label: 'Hair',            hint: 'Hair tied back or neatly combed' },
  { key: 'nailsClean',           emoji: '✋', label: 'Nails',           hint: 'Nails trimmed and clean — no nail polish' },
  { key: 'accessoriesCompliant', emoji: '💍', label: 'Accessories',     hint: 'No prohibited jewellery, piercings, or wristbands' },
  { key: 'shoeCompliant',        emoji: '👟', label: 'Footwear',        hint: 'Correct closed-toe shoes, clean and presentable' },
];

const MAX_SELFIE = 2;

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
      {children}
    </p>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function GroomingTaskDetail({ task, onBack }: Props) {
  const isReadOnly = task.status === 'completed';

  const [checks, setChecks] = useState<ChecklistState>({
    uniformComplete:      task.uniformComplete      ?? false,
    hairGroomed:          task.hairGroomed          ?? false,
    nailsClean:           task.nailsClean           ?? false,
    accessoriesCompliant: task.accessoriesCompliant ?? false,
    shoeCompliant:        task.shoeCompliant        ?? false,
  });
  const [notes, setNotes]             = useState(task.groomingNotes ?? '');
  const [selfies, setSelfies]         = useState<string[]>(task.selfiePhotos ?? []);
  const [uploading, setUploading]     = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [submitting, setSubmitting]   = useState(false);
  const [error, setError]             = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  const toggleCheck = (key: keyof ChecklistState) => {
    if (isReadOnly) return;
    setChecks((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleUpload = async (file: File) => {
    setUploadError(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('photoType', 'selfie');
      const res  = await fetch('/api/employee/tasks/upload', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Upload failed');
      setSelfies((p) => [...p, data.url]);
    } catch (e: any) {
      setUploadError(e.message);
    } finally {
      setUploading(false);
    }
  };

  const completedChecks  = Object.values(checks).filter(Boolean).length;
  const allChecksPassed  = completedChecks === CHECKLIST_ITEMS.length;
  const canSubmit        = !isReadOnly && allChecksPassed && selfies.length >= 1;

  // Progress: 40% checklist, 60% selfie
  const progress = isReadOnly ? 100 : Math.round(
    (completedChecks / CHECKLIST_ITEMS.length) * 40 +
    (selfies.length >= 1 ? 60 : selfies.length > 0 ? 30 : 0)
  );

  const handleSubmit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/employee/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskType: 'grooming',
          taskId:   task.id,
          ...checks,
          groomingNotes: notes || null,
          selfiePhotos:  selfies,
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
            <User className="h-5 w-5 text-primary-foreground" />
          </div>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-primary-foreground">Grooming Check</h1>
            <p className="mt-0.5 text-xs text-primary-foreground/60">
              {new Date(task.date).toLocaleDateString('en-ID', {
                weekday: 'long', day: 'numeric', month: 'long',
              })}{' '}
              · <span className="capitalize">{task.shift}</span> shift
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
            <span>{progress}%</span>
          </div>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/20">
            <div
              className="h-full rounded-full bg-white transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </div>

      {/* ── Scrollable content ── */}
      <div className="flex-1 space-y-4 overflow-y-auto p-4 pb-32">

        {/* Checklist */}
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <SectionLabel>Grooming Checklist</SectionLabel>
            <span className="text-[10px] font-bold text-primary">
              {completedChecks}/{CHECKLIST_ITEMS.length}
            </span>
          </div>

          <div className="space-y-1.5">
            {CHECKLIST_ITEMS.map(({ key, emoji, label, hint }) => {
              const checked = checks[key];
              return (
                <button
                  key={key}
                  type="button"
                  disabled={isReadOnly}
                  onClick={() => toggleCheck(key)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-all',
                    checked
                      ? 'bg-green-50 dark:bg-green-950/20 ring-1 ring-green-200 dark:ring-green-900'
                      : 'bg-secondary hover:bg-border',
                    isReadOnly && 'cursor-default',
                  )}
                >
                  {/* Emoji */}
                  <span className="text-lg leading-none">{emoji}</span>

                  {/* Text */}
                  <div className="flex-1">
                    <p className={cn(
                      'text-sm font-semibold leading-tight',
                      checked ? 'text-green-700 dark:text-green-400' : 'text-foreground',
                    )}>
                      {label}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>
                  </div>

                  {/* Checkbox */}
                  <div className={cn(
                    'flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border-2 transition-all',
                    checked
                      ? 'border-green-500 bg-green-500'
                      : 'border-muted-foreground/30 bg-background',
                  )}>
                    {checked && <CheckCircle2 className="h-3.5 w-3.5 text-white" strokeWidth={3} />}
                  </div>
                </button>
              );
            })}
          </div>

          {/* All-clear banner */}
          {allChecksPassed && (
            <div className="mt-3 flex items-center gap-2 rounded-xl bg-green-50 dark:bg-green-950/20 px-3 py-2.5">
              <CheckCircle2 className="h-4 w-4 text-green-600 flex-shrink-0" />
              <p className="text-xs font-semibold text-green-700 dark:text-green-400">
                All grooming standards met!
              </p>
            </div>
          )}
        </div>

        {/* Selfie upload */}
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="mb-1 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Camera className="h-4 w-4 text-muted-foreground" />
              <SectionLabel>Selfie Photo</SectionLabel>
            </div>
            <span className="text-[10px] text-muted-foreground">
              {selfies.length}/{MAX_SELFIE} · min 1 required
            </span>
          </div>
          <p className="mb-3 text-[11px] text-muted-foreground">
            Take a full-body photo clearly showing your uniform and appearance.
          </p>

          <div className="flex gap-3">
            {/* Thumbnails */}
            {selfies.map((url, i) => (
              <div
                key={i}
                className="relative h-28 w-24 flex-shrink-0 overflow-hidden rounded-xl border border-border"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt={`selfie-${i}`} className="h-full w-full object-cover" />
                {!isReadOnly && (
                  <button
                    type="button"
                    onClick={() => setSelfies((p) => p.filter((_, idx) => idx !== i))}
                    className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            ))}

            {/* Add button */}
            {!isReadOnly && selfies.length < MAX_SELFIE && (
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={uploading}
                className="flex h-28 w-24 flex-shrink-0 flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-border bg-secondary text-muted-foreground transition-colors hover:border-primary hover:text-primary"
              >
                {uploading ? (
                  <Loader2 className="h-6 w-6 animate-spin" />
                ) : (
                  <>
                    <ImagePlus className="h-6 w-6" />
                    <span className="text-[11px] font-medium">Take selfie</span>
                  </>
                )}
              </button>
            )}
          </div>

          {uploadError && (
            <p className="mt-2 flex items-center gap-1 text-[11px] text-destructive">
              <AlertCircle className="h-3 w-3" /> {uploadError}
            </p>
          )}

          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            capture="user"    // front camera for selfie
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleUpload(file);
              e.target.value = '';
            }}
          />
        </div>

        {/* Notes */}
        <div className="rounded-2xl border border-border bg-card p-4">
          <SectionLabel>Notes (optional)</SectionLabel>
          <Textarea
            value={notes}
            onChange={(e) => { if (!isReadOnly) setNotes(e.target.value); }}
            readOnly={isReadOnly}
            placeholder="Any exceptions or remarks about your appearance today…"
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
              <><CheckCircle2 className="h-4 w-4" /> Submit Grooming Check</>
            )}
          </Button>
          {!canSubmit && !submitting && (
            <p className="mt-2 text-center text-[10px] text-muted-foreground">
              {!allChecksPassed && `${CHECKLIST_ITEMS.length - completedChecks} checklist item(s) remaining · `}
              {selfies.length < 1 && 'Selfie photo required'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}