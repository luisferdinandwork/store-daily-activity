// components/employee/TaskDetailView.tsx
'use client';

import { useState, useRef } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  ArrowLeft,
  Camera,
  X,
  CheckCircle2,
  Loader2,
  Clock,
  FileText,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AssignedTask, FormField } from '@/app/employee/tasks/page';

// ─── Dynamic field renderer ───────────────────────────────────────────────────
function DynamicField({
  field,
  value,
  onChange,
  disabled,
}: {
  field: FormField;
  value: unknown;
  onChange: (id: string, val: unknown) => void;
  disabled?: boolean;
}) {
  switch (field.type) {
    case 'text':
      return (
        <Input
          id={`field-${field.id}`}
          disabled={disabled}
          placeholder={field.placeholder ?? ''}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(field.id, e.target.value)}
        />
      );

    case 'number':
      return (
        <Input
          id={`field-${field.id}`}
          type="number"
          inputMode="decimal"
          disabled={disabled}
          placeholder={field.placeholder ?? ''}
          value={(value as string) ?? ''}
          min={field.validation?.min}
          max={field.validation?.max}
          onChange={(e) =>
            onChange(field.id, e.target.value === '' ? '' : Number(e.target.value))
          }
        />
      );

    case 'textarea':
      return (
        <Textarea
          id={`field-${field.id}`}
          disabled={disabled}
          placeholder={field.placeholder ?? ''}
          value={(value as string) ?? ''}
          rows={3}
          onChange={(e) => onChange(field.id, e.target.value)}
        />
      );

    case 'select':
      return (
        <Select
          value={(value as string) ?? ''}
          onValueChange={(v) => onChange(field.id, v)}
          disabled={disabled}
        >
          <SelectTrigger id={`field-${field.id}`}>
            <SelectValue placeholder="Select an option…" />
          </SelectTrigger>
          <SelectContent>
            {field.options?.map((o) => (
              <SelectItem key={o} value={o}>
                {o}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );

    case 'checkbox':
      return (
        <div className="flex items-center gap-2.5 py-1">
          <Switch
            id={`field-${field.id}`}
            checked={Boolean(value)}
            onCheckedChange={(v) => onChange(field.id, v)}
            disabled={disabled}
          />
          <Label htmlFor={`field-${field.id}`} className="cursor-pointer text-sm">
            {field.label}
          </Label>
        </div>
      );

    case 'date':
      return (
        <Input
          id={`field-${field.id}`}
          type="date"
          disabled={disabled}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(field.id, e.target.value)}
        />
      );

    case 'time':
      return (
        <Input
          id={`field-${field.id}`}
          type="time"
          disabled={disabled}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(field.id, e.target.value)}
        />
      );

    default:
      return null;
  }
}

// ─── Camera capture ───────────────────────────────────────────────────────────
function CameraCapture({
  maxAttachments,
  required,
  urls,
  onUrls,
  disabled,
}: {
  maxAttachments: number;
  required: boolean;
  urls: string[];
  onUrls: (u: string[]) => void;
  disabled: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const canAdd = !disabled && !uploading && urls.length < maxAttachments;

  const handleCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;

    const toUpload = files.slice(0, maxAttachments - urls.length);
    setUploading(true);
    try {
      const newUrls = await Promise.all(
        toUpload.map(async (file) => {
          const fd = new FormData();
          fd.append('file', file);
          const res = await fetch('/api/employee/tasks/upload', { method: 'POST', body: fd });
          if (!res.ok) throw new Error((await res.json()).error ?? 'Upload failed');
          return (await res.json()).url as string;
        }),
      );
      onUrls([...urls, ...newUrls]);
      toast.success(`${newUrls.length} photo${newUrls.length > 1 ? 's' : ''} saved`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-2.5">
      {/* capture="environment" forces rear camera — no gallery picker */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple={maxAttachments > 1}
        onChange={handleCapture}
        className="hidden"
        aria-hidden
      />

      <div className="grid grid-cols-3 gap-2">
        {urls.map((url, i) => (
          <div
            key={i}
            className="group relative aspect-square overflow-hidden rounded-xl border border-border"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={`Photo ${i + 1}`} className="h-full w-full object-cover" />
            {!disabled && (
              <button
                type="button"
                onClick={() => onUrls(urls.filter((_, idx) => idx !== i))}
                className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100 active:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        ))}

        {urls.length < maxAttachments && (
          <button
            type="button"
            disabled={!canAdd}
            onClick={() => inputRef.current?.click()}
            className={cn(
              'flex aspect-square flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed transition-colors',
              canAdd
                ? 'border-primary/40 bg-primary/5 text-primary active:scale-95'
                : 'cursor-not-allowed border-border bg-secondary text-muted-foreground opacity-50',
            )}
          >
            {uploading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <>
                <Camera className="h-5 w-5" />
                <span className="text-[10px] font-semibold uppercase tracking-wide">
                  {urls.length === 0 ? 'Take Photo' : 'Add More'}
                </span>
              </>
            )}
          </button>
        )}
      </div>

      <p className="text-xs">
        {required && urls.length === 0 ? (
          <span className="text-destructive">At least one photo is required</span>
        ) : urls.length > 0 ? (
          <span className="text-green-600">
            {urls.length}/{maxAttachments} photo{urls.length > 1 ? 's' : ''} captured
          </span>
        ) : (
          <span className="text-muted-foreground">Optional</span>
        )}
      </p>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function TaskDetailView({
  task,
  onBack,
}: {
  task: AssignedTask;
  onBack: () => void;
}) {
  const [formValues, setFormValues] = useState<Record<string, unknown>>(
    task.employeeTask.formData ?? {},
  );
  const [photoUrls, setPhotoUrls] = useState<string[]>(
    task.employeeTask.attachmentUrls ?? [],
  );
  const [notes, setNotes] = useState(task.employeeTask.notes ?? '');
  const [submitting, setSubmitting] = useState(false);

  const { task: t, employeeTask: et } = task;
  const isCompleted = et.status === 'completed';

  const setField = (id: string, val: unknown) =>
    setFormValues((prev) => ({ ...prev, [id]: val }));

  const validate = (): string | null => {
    if (t.requiresAttachment && photoUrls.length === 0)
      return 'Please take at least one photo before submitting';
    if (t.requiresForm && t.formSchema) {
      for (const field of t.formSchema.fields) {
        if (field.type === 'checkbox') continue;
        const val = formValues[field.id];
        if (field.required && (val === undefined || val === null || val === ''))
          return `"${field.label}" is required`;
      }
    }
    return null;
  };

  const handleSubmit = async () => {
    const err = validate();
    if (err) { toast.error(err); return; }

    setSubmitting(true);
    try {
      const res = await fetch('/api/employee/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeTaskId: et.id,
          formData: t.requiresForm ? formValues : undefined,
          attachmentUrls: photoUrls.length > 0 ? photoUrls : undefined,
          notes: notes.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? 'Failed to submit');
      toast.success('Task completed! 🎉');
      setTimeout(onBack, 600);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Submission failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col pb-32">
      {/* ── Header ── */}
      <div className="relative overflow-hidden bg-primary px-5 pb-6 pt-10">
        <div className="pointer-events-none absolute -right-8 -top-8 h-36 w-36 rounded-full bg-white/5" />

        <button
          type="button"
          onClick={onBack}
          className="relative mb-4 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-primary-foreground/60 hover:text-primary-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Tasks
        </button>

        <h1 className="relative text-xl font-bold leading-tight text-primary-foreground">
          {t.title}
        </h1>
        {t.description && (
          <p className="relative mt-1 text-xs text-primary-foreground/50">{t.description}</p>
        )}

        <div className="relative mt-3 flex flex-wrap gap-1.5">
          {t.shift && (
            <Badge className="h-5 bg-white/10 text-[10px] text-primary-foreground hover:bg-white/10">
              <Clock className="mr-1 h-2.5 w-2.5" />
              {t.shift} shift
            </Badge>
          )}
          {t.requiresForm && (
            <Badge className="h-5 bg-white/10 text-[10px] text-primary-foreground hover:bg-white/10">
              <FileText className="mr-1 h-2.5 w-2.5" />
              Form required
            </Badge>
          )}
          {t.requiresAttachment && (
            <Badge className="h-5 bg-white/10 text-[10px] text-primary-foreground hover:bg-white/10">
              <Camera className="mr-1 h-2.5 w-2.5" />
              Photo required
            </Badge>
          )}
          {isCompleted && (
            <Badge className="h-5 bg-green-400/20 text-[10px] text-green-200 hover:bg-green-400/20">
              <CheckCircle2 className="mr-1 h-2.5 w-2.5" />
              Completed
            </Badge>
          )}
        </div>
      </div>

      {/* Completed banner */}
      {isCompleted && (
        <div className="mx-4 mt-4 flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 p-3 text-sm font-medium text-green-700">
          <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-green-500" />
          Completed at{' '}
          {et.completedAt
            ? new Date(et.completedAt).toLocaleTimeString('en-ID', {
                hour: '2-digit',
                minute: '2-digit',
              })
            : '—'}
        </div>
      )}

      {/* ── Body ── */}
      <div className="space-y-3 p-4">
        {/* Dynamic form */}
        {t.requiresForm && t.formSchema && t.formSchema.fields.length > 0 && (
          <Card>
            <CardContent className="space-y-4 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                Task Form
              </p>
              {t.formSchema.fields.map((field) => (
                <div key={field.id} className="space-y-1.5">
                  {field.type !== 'checkbox' && (
                    <Label htmlFor={`field-${field.id}`} className="text-xs font-medium">
                      {field.label}
                      {field.required && (
                        <span className="ml-0.5 text-destructive">*</span>
                      )}
                    </Label>
                  )}
                  <DynamicField
                    field={field}
                    value={formValues[field.id]}
                    onChange={isCompleted ? () => {} : setField}
                    disabled={isCompleted}
                  />
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Photo capture */}
        {t.requiresAttachment && (
          <Card>
            <CardContent className="space-y-3 p-4">
              <div className="flex items-center gap-1">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Photo Evidence
                </p>
                {!isCompleted && (
                  <span className="text-[10px] text-destructive">*</span>
                )}
              </div>
              <CameraCapture
                maxAttachments={t.maxAttachments || 3}
                required={t.requiresAttachment}
                urls={photoUrls}
                onUrls={isCompleted ? () => {} : setPhotoUrls}
                disabled={isCompleted}
              />
            </CardContent>
          </Card>
        )}

        {/* Notes */}
        <Card>
          <CardContent className="space-y-1.5 p-4">
            <Label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              Notes (Optional)
            </Label>
            <Textarea
              placeholder="Add any additional notes…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={isCompleted}
              rows={3}
            />
          </CardContent>
        </Card>
      </div>

      {/* ── Fixed submit button ── */}
      {!isCompleted && (
        <div className="fixed bottom-16 left-0 right-0 border-t border-border bg-card/80 px-4 py-3 backdrop-blur-sm">
          <Button
            className="h-12 w-full text-sm font-bold tracking-wide"
            onClick={handleSubmit}
            disabled={submitting}
          >
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Submitting…
              </>
            ) : (
              <>
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Complete Task
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}