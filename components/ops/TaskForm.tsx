// components/ops/TaskForm.tsx
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { ArrowLeft, Plus, X, GripVertical, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────
type Recurrence = 'daily' | 'weekly' | 'monthly';
type FieldType = 'text' | 'number' | 'textarea' | 'select' | 'checkbox' | 'date' | 'time';

interface FormField {
  id: string;
  type: FieldType;
  label: string;
  required: boolean;
  options?: string[];
  placeholder?: string;
  validation?: { min?: number; max?: number };
}

const WEEKDAYS = [
  { val: 0, label: 'Su' },
  { val: 1, label: 'Mo' },
  { val: 2, label: 'Tu' },
  { val: 3, label: 'We' },
  { val: 4, label: 'Th' },
  { val: 5, label: 'Fr' },
  { val: 6, label: 'Sa' },
];

const MONTH_DAYS = Array.from({ length: 31 }, (_, i) => i + 1);

const OPS_USER_ID = 'your-ops-user-id'; // Replace with session

function uid() {
  return Math.random().toString(36).slice(2, 8);
}

function toggle<T>(arr: T[], item: T): T[] {
  return arr.includes(item) ? arr.filter((x) => x !== item) : [...arr, item];
}

interface Props {
  /** If provided, loads and edits this task */
  taskId?: string;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function TaskForm({ taskId }: Props) {
  const router = useRouter();
  const isEdit = Boolean(taskId);

  // Basic
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [role, setRole] = useState('employee');
  const [employeeType, setEmployeeType] = useState('');
  const [shift, setShift] = useState('');

  // Recurrence
  const [recurrence, setRecurrence] = useState<Recurrence>('daily');
  const [selectedDays, setSelectedDays] = useState<number[]>([]);

  // Requirements
  const [requiresForm, setRequiresForm] = useState(false);
  const [formFields, setFormFields] = useState<FormField[]>([]);
  const [requiresAttachment, setRequiresAttachment] = useState(false);
  const [maxAttachments, setMaxAttachments] = useState(1);

  const [saving, setSaving] = useState(false);
  const [loadingTask, setLoadingTask] = useState(isEdit);
  const [error, setError] = useState('');

  // Load existing task for edit
  useEffect(() => {
    if (!taskId) return;
    setLoadingTask(true);
    fetch(`/api/ops/tasks/${taskId}`)
      .then((r) => r.json())
      .then(({ success, data }) => {
        if (!success) {
          toast.error('Task not found');
          return;
        }
        setTitle(data.title ?? '');
        setDescription(data.description ?? '');
        setRole(data.role ?? 'employee');
        setEmployeeType(data.employeeType ?? '');
        setShift(data.shift ?? '');
        setRecurrence(data.recurrence ?? 'daily');
        setSelectedDays(data.recurrenceDays ?? []);
        setRequiresForm(data.requiresForm ?? false);
        setFormFields(data.formSchema?.fields ?? []);
        setRequiresAttachment(data.requiresAttachment ?? false);
        setMaxAttachments(data.maxAttachments ?? 1);
      })
      .catch(() => toast.error('Failed to load task'))
      .finally(() => setLoadingTask(false));
  }, [taskId]);

  // Form field helpers
  const addField = () =>
    setFormFields((p) => [...p, { id: uid(), type: 'text', label: '', required: false }]);

  const updateField = (idx: number, patch: Partial<FormField>) =>
    setFormFields((p) => p.map((f, i) => (i === idx ? { ...f, ...patch } : f)));

  const removeField = (idx: number) =>
    setFormFields((p) => p.filter((_, i) => i !== idx));

  const moveField = (idx: number, dir: -1 | 1) => {
    setFormFields((p) => {
      const next = [...p];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return p;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  };

  // Validate & submit
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!title.trim()) return setError('Title is required');
    if (recurrence !== 'daily' && selectedDays.length === 0)
      return setError(
        `Select at least one ${recurrence === 'weekly' ? 'weekday' : 'day of month'}`,
      );
    if (requiresForm && formFields.length === 0)
      return setError('Add at least one form field or disable "Requires Form"');
    for (const f of formFields) {
      if (!f.label.trim()) return setError('All form fields need a label');
    }

    setSaving(true);
    const body = {
      title: title.trim(),
      description: description.trim() || undefined,
      role,
      employeeType: employeeType || undefined,
      shift: shift || undefined,
      recurrence,
      recurrenceDays: recurrence !== 'daily' ? selectedDays : undefined,
      requiresForm,
      formSchema: requiresForm ? { fields: formFields } : undefined,
      requiresAttachment,
      maxAttachments: requiresAttachment ? maxAttachments : undefined,
      createdBy: OPS_USER_ID,
    };

    const url = isEdit ? `/api/ops/tasks/${taskId}` : '/api/ops/tasks';
    const method = isEdit ? 'PATCH' : 'POST';

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    setSaving(false);

    if (json.success) {
      toast.success(isEdit ? 'Task updated' : 'Task created');
      router.push('/ops/tasks');
    } else {
      setError(json.error ?? 'Failed to save task');
    }
  }

  if (loadingTask) {
    return (
      <div className="p-6">
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg bg-secondary" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/ops/tasks">
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {isEdit ? 'Edit Task' : 'Create Task'}
          </h1>
          <p className="text-sm text-muted-foreground">
            {isEdit ? 'Update task template details' : 'Add a new task template'}
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">

        {/* ── Basic Info ── */}
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-sm text-muted-foreground uppercase tracking-wider">
              Basic Information
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="title">Task Title <span className="text-destructive">*</span></Label>
              <Input
                id="title"
                placeholder="e.g. Morning Inventory Check"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                placeholder="What does this task involve?"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label>Role <span className="text-destructive">*</span></Label>
                <Select value={role} onValueChange={setRole}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="employee">Employee</SelectItem>
                    <SelectItem value="ops">OPS</SelectItem>
                    <SelectItem value="finance">Finance</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Employee Type</Label>
                <Select value={employeeType || 'all'} onValueChange={(v) => setEmployeeType(v === 'all' ? '' : v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    <SelectItem value="pic">PIC</SelectItem>
                    <SelectItem value="so">SO</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Shift</Label>
                <Select value={shift || 'both'} onValueChange={(v) => setShift(v === 'both' ? '' : v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="both">Both Shifts</SelectItem>
                    <SelectItem value="morning">Morning</SelectItem>
                    <SelectItem value="evening">Evening</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── Recurrence ── */}
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-sm text-muted-foreground uppercase tracking-wider">
              Recurrence Schedule
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Frequency <span className="text-destructive">*</span></Label>
              <div className="grid grid-cols-3 gap-2">
                {(['daily', 'weekly', 'monthly'] as Recurrence[]).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => { setRecurrence(r); setSelectedDays([]); }}
                    className={cn(
                      'rounded-md border px-3 py-2 text-sm font-medium capitalize transition-colors',
                      recurrence === r
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border bg-background text-muted-foreground hover:bg-secondary',
                    )}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>

            {recurrence === 'daily' && (
              <p className="text-xs text-muted-foreground">
                ✓ This task will be assigned to all matching employees every day automatically.
              </p>
            )}

            {recurrence === 'weekly' && (
              <div className="space-y-2">
                <Label>Days of the week <span className="text-destructive">*</span></Label>
                <div className="flex gap-1.5 flex-wrap">
                  {WEEKDAYS.map(({ val, label }) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setSelectedDays(toggle(selectedDays, val))}
                      className={cn(
                        'h-9 w-9 rounded-full border text-xs font-semibold transition-colors',
                        selectedDays.includes(val)
                          ? 'border-violet-500 bg-violet-100 text-violet-700'
                          : 'border-border bg-background text-muted-foreground hover:bg-secondary',
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {selectedDays.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Task will appear on:{' '}
                    {selectedDays
                      .sort((a, b) => a - b)
                      .map((d) => WEEKDAYS.find((w) => w.val === d)?.label)
                      .join(', ')}
                    {selectedDays.length > 1 && ' — multiple times per week'}
                  </p>
                )}
              </div>
            )}

            {recurrence === 'monthly' && (
              <div className="space-y-2">
                <Label>Days of the month <span className="text-destructive">*</span></Label>
                <div className="flex flex-wrap gap-1">
                  {MONTH_DAYS.map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setSelectedDays(toggle(selectedDays, d))}
                      className={cn(
                        'h-8 w-8 rounded border text-xs font-medium transition-colors',
                        selectedDays.includes(d)
                          ? 'border-amber-500 bg-amber-50 text-amber-700'
                          : 'border-border bg-background text-muted-foreground hover:bg-secondary',
                      )}
                    >
                      {d}
                    </button>
                  ))}
                </div>
                {selectedDays.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Selected: {selectedDays.sort((a, b) => a - b).join(', ')}
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Requirements ── */}
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-sm text-muted-foreground uppercase tracking-wider">
              Completion Requirements
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Requires Form Submission</p>
                <p className="text-xs text-muted-foreground">
                  Employee must fill out a form when completing this task
                </p>
              </div>
              <Switch checked={requiresForm} onCheckedChange={setRequiresForm} />
            </div>

            <Separator />

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Requires File Attachment</p>
                <p className="text-xs text-muted-foreground">
                  Employee must take a photo to complete this task
                </p>
              </div>
              <Switch checked={requiresAttachment} onCheckedChange={setRequiresAttachment} />
            </div>

            {requiresAttachment && (
              <div className="flex items-center gap-3 pl-4">
                <Label className="text-sm text-muted-foreground w-28">Max photos</Label>
                <Input
                  type="number"
                  min={1}
                  max={10}
                  value={maxAttachments}
                  onChange={(e) => setMaxAttachments(Number(e.target.value))}
                  className="w-20 h-8"
                />
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Form Builder ── */}
        {requiresForm && (
          <Card>
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm text-muted-foreground uppercase tracking-wider">
                  Form Builder
                </CardTitle>
                <Button type="button" variant="outline" size="sm" onClick={addField} className="gap-1.5 h-8">
                  <Plus className="h-3.5 w-3.5" />
                  Add Field
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {formFields.length === 0 && (
                <p className="text-center text-sm text-muted-foreground py-4">
                  No fields yet. Click "Add Field" to start building your form.
                </p>
              )}

              {formFields.map((field, idx) => (
                <div
                  key={field.id}
                  className="rounded-lg border border-border bg-secondary/30 p-3 space-y-3"
                >
                  <div className="flex items-center gap-2">
                    <GripVertical className="h-4 w-4 text-muted-foreground flex-shrink-0" />

                    <Input
                      placeholder="Field label *"
                      value={field.label}
                      onChange={(e) => updateField(idx, { label: e.target.value })}
                      className="h-8 flex-1"
                    />

                    <Select
                      value={field.type}
                      onValueChange={(v) => updateField(idx, { type: v as FieldType })}
                    >
                      <SelectTrigger className="h-8 w-28">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(['text', 'number', 'textarea', 'select', 'checkbox', 'date', 'time'] as FieldType[]).map(
                          (t) => (
                            <SelectItem key={t} value={t} className="capitalize">
                              {t}
                            </SelectItem>
                          ),
                        )}
                      </SelectContent>
                    </Select>

                    <div className="flex gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => moveField(idx, -1)}
                        disabled={idx === 0}
                      >
                        ↑
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => moveField(idx, 1)}
                        disabled={idx === formFields.length - 1}
                      >
                        ↓
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => removeField(idx)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 pl-6">
                    <Input
                      placeholder="Placeholder text"
                      value={field.placeholder ?? ''}
                      onChange={(e) => updateField(idx, { placeholder: e.target.value })}
                      className="h-8"
                    />
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={field.required}
                        onCheckedChange={(v) => updateField(idx, { required: v })}
                        id={`req-${field.id}`}
                      />
                      <Label htmlFor={`req-${field.id}`} className="text-xs cursor-pointer">
                        Required
                      </Label>
                    </div>
                  </div>

                  {field.type === 'number' && (
                    <div className="grid grid-cols-2 gap-2 pl-6">
                      <Input
                        type="number"
                        placeholder="Min value"
                        value={field.validation?.min ?? ''}
                        onChange={(e) =>
                          updateField(idx, {
                            validation: {
                              ...field.validation,
                              min: e.target.value ? Number(e.target.value) : undefined,
                            },
                          })
                        }
                        className="h-8"
                      />
                      <Input
                        type="number"
                        placeholder="Max value"
                        value={field.validation?.max ?? ''}
                        onChange={(e) =>
                          updateField(idx, {
                            validation: {
                              ...field.validation,
                              max: e.target.value ? Number(e.target.value) : undefined,
                            },
                          })
                        }
                        className="h-8"
                      />
                    </div>
                  )}

                  {field.type === 'select' && (
                    <div className="pl-6">
                      <Input
                        placeholder="Options (comma-separated) e.g. Yes, No, Partial"
                        value={(field.options ?? []).join(', ')}
                        onChange={(e) =>
                          updateField(idx, {
                            options: e.target.value
                              .split(',')
                              .map((s) => s.trim())
                              .filter(Boolean),
                          })
                        }
                        className="h-8"
                      />
                    </div>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Submit */}
        <div className="flex gap-3">
          <Button type="submit" disabled={saving} className="gap-1.5">
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Task'}
          </Button>
          <Link href="/ops/tasks">
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </Link>
        </div>
      </form>
    </div>
  );
}