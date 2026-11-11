'use client';
// app/it/store-closing-hold/page.tsx — IT only.
//
// Sets up what happens when an employee puts the Store Closing "Open Statement" On Hold:
//   • the default title + description of the issue that goes to Ops / Finance / IT;
//   • the categories the employee picks from, each optionally with its own description
//     (blank = the default text).
// Text is plain with {{placeholders}} (lib/store-closing-hold.ts); the preview shows it
// filled with sample data. Employees see the active categories on the Store Closing page.

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import {
  ArrowLeft, Check, ChevronDown, ChevronUp, Eye, EyeOff, Loader2, PauseCircle, Pencil, Plus,
  RotateCcw, Shield, Sparkles, Trash2, X,
} from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import PanelPageHeader from '@/components/shared/PanelPageHeader';
import { OpsList } from '@/components/ops/layout/OpsList';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  HOLD_CATEGORY_NAME_MAX,
  HOLD_DESCRIPTION_MAX,
  HOLD_PLACEHOLDERS,
  HOLD_SAMPLE_VARS,
  HOLD_TITLE_MAX,
  STARTER_HOLD_CATEGORIES,
  holdTemplateProblem,
  renderHoldTemplate,
  type HoldCategoryAdminDto,
} from '@/lib/store-closing-hold';

// ─── Types + API ──────────────────────────────────────────────────────────────

type TemplateState = {
  title: string;
  description: string;
  isCustom: boolean;
  updatedAt: string | null;
  updatedByName: string | null;
};

type Overview = {
  template: TemplateState;
  categories: HoldCategoryAdminDto[];
};

async function api(url: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.success) throw new Error(json.error ?? 'Request failed');
  return json;
}

function formatWhen(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('id-ID', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    timeZone: 'Asia/Jakarta',
  });
}

// ─── Placeholder chips + preview ──────────────────────────────────────────────

/** Click a chip to drop `{{name}}` into the field at the cursor. */
function PlaceholderChips({ onInsert, only }: { onInsert: (name: string) => void; only?: readonly string[] }) {
  const list = only ? HOLD_PLACEHOLDERS.filter((p) => only.includes(p.name)) : HOLD_PLACEHOLDERS;
  return (
    <div className="flex flex-wrap gap-1.5">
      {list.map((p) => (
        <button
          key={p.name}
          type="button"
          title={p.description}
          onClick={() => onInsert(p.name)}
          className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-[11px] font-semibold text-slate-600 transition hover:border-cyan-300 hover:bg-cyan-50 hover:text-cyan-700"
        >
          {`{{${p.name}}}`}
        </button>
      ))}
    </div>
  );
}

/** What the employee's issue will look like, filled with sample data. */
function IssuePreview({ title, description }: { title?: string; description: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Preview · sample data</p>
      {title !== undefined && (
        <p className="mt-2 text-sm font-bold text-slate-900">
          {renderHoldTemplate(title, HOLD_SAMPLE_VARS) || <span className="font-normal italic text-slate-400">No title</span>}
        </p>
      )}
      <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-slate-700">
        {renderHoldTemplate(description, HOLD_SAMPLE_VARS) || (
          <span className="italic text-slate-400">Nothing to preview yet.</span>
        )}
      </p>
    </div>
  );
}

/** Write `{{name}}` into `value` at the textarea's / input's cursor. */
function insertAtCursor(
  el: HTMLTextAreaElement | HTMLInputElement | null,
  value: string,
  name: string,
  set: (next: string) => void,
) {
  const token = `{{${name}}}`;
  const start = el?.selectionStart ?? value.length;
  const end = el?.selectionEnd ?? value.length;
  set(value.slice(0, start) + token + value.slice(end));
  requestAnimationFrame(() => {
    el?.focus();
    el?.setSelectionRange(start + token.length, start + token.length);
  });
}

// ─── Default template card ────────────────────────────────────────────────────

function DefaultTemplateCard({
  state, onSaved,
}: {
  state: TemplateState;
  onSaved: (t: TemplateState) => void;
}) {
  const [title, setTitle] = useState(state.title);
  const [description, setDescription] = useState(state.description);
  const [busy, setBusy] = useState<'save' | 'reset' | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);
  // Clicking a chip moves focus onto the chip, so remember which field was used last.
  const lastField = useRef<'title' | 'description'>('description');

  const titleProblem = holdTemplateProblem('title', title);
  const descriptionProblem = holdTemplateProblem('description', description);
  const dirty = title.trim() !== state.title || description.trim() !== state.description;
  const canSave = dirty && !titleProblem && !descriptionProblem && busy === null;

  async function save() {
    if (!canSave) return;
    setBusy('save');
    try {
      const json = await api('/api/it/store-closing-hold/template', {
        method: 'PUT',
        body: JSON.stringify({ title, description }),
      });
      onSaved(json.template);
      toast.success('Default issue text saved');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(null);
    }
  }

  async function reset() {
    setBusy('reset');
    try {
      const json = await api('/api/it/store-closing-hold/template', { method: 'DELETE' });
      onSaved(json.template);
      setConfirmReset(false);
      toast.success('Back to the built-in text');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not reset');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-slate-900">Default issue text</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            The issue Ops, Finance and IT receive when a store puts Open Statement On Hold. A category with its own
            description below overrides the description (the title always comes from here).
          </p>
        </div>
        <span
          className={cn(
            'rounded-full px-2.5 py-1 text-[11px] font-bold',
            state.isCustom ? 'bg-cyan-50 text-cyan-700' : 'bg-slate-100 text-slate-500',
          )}
        >
          {state.isCustom ? 'Customised' : 'Built-in text'}
        </span>
      </div>

      <div className="grid gap-5 px-5 py-4 xl:grid-cols-2">
        <div className="space-y-4">
          <label className="block space-y-1.5">
            <span className="flex items-center justify-between text-xs font-bold text-slate-600">
              Issue title
              <span className="font-semibold tabular-nums text-slate-400">{title.length}/{HOLD_TITLE_MAX}</span>
            </span>
            <input
              ref={titleRef}
              value={title}
              onFocus={() => { lastField.current = 'title'; }}
              onChange={(e) => setTitle(e.target.value)}
              className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm focus:border-cyan-400 focus:outline-none"
            />
            {titleProblem && <span className="block text-[11px] font-semibold text-rose-600">{titleProblem}</span>}
          </label>

          <label className="block space-y-1.5">
            <span className="flex items-center justify-between text-xs font-bold text-slate-600">
              Issue description
              <span className="font-semibold tabular-nums text-slate-400">{description.length}/{HOLD_DESCRIPTION_MAX}</span>
            </span>
            <textarea
              ref={descRef}
              value={description}
              onFocus={() => { lastField.current = 'description'; }}
              onChange={(e) => setDescription(e.target.value)}
              rows={12}
              className="w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-[13px] leading-relaxed focus:border-cyan-400 focus:outline-none"
            />
            {descriptionProblem && (
              <span className="block text-[11px] font-semibold text-rose-600">{descriptionProblem}</span>
            )}
          </label>

          <div className="space-y-1.5">
            <p className="text-xs font-bold text-slate-600">Placeholders <span className="font-medium text-slate-400">— click to insert at the cursor</span></p>
            <PlaceholderChips
              onInsert={(name) => {
                if (lastField.current === 'title') insertAtCursor(titleRef.current, title, name, setTitle);
                else insertAtCursor(descRef.current, description, name, setDescription);
              }}
            />
            <ul className="space-y-0.5 pt-1 text-[11px] text-slate-400">
              {HOLD_PLACEHOLDERS.map((p) => (
                <li key={p.name}><span className="font-mono text-slate-500">{`{{${p.name}}}`}</span> — {p.description}</li>
              ))}
            </ul>
          </div>
        </div>

        <div className="space-y-3">
          <IssuePreview title={title} description={description} />
          {state.isCustom && state.updatedAt && (
            <p className="text-[11px] text-slate-400">
              Last saved {formatWhen(state.updatedAt)}{state.updatedByName ? ` by ${state.updatedByName}` : ''}.
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 px-5 py-3">
        {state.isCustom && (
          <button
            type="button"
            onClick={() => setConfirmReset(true)}
            disabled={busy !== null}
            className="flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-500 hover:bg-slate-50 disabled:opacity-50"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Reset to built-in text
          </button>
        )}
        <button
          type="button"
          disabled={!canSave}
          onClick={save}
          className="flex h-9 items-center gap-1.5 rounded-lg bg-cyan-600 px-4 text-xs font-bold text-white disabled:opacity-50"
        >
          {busy === 'save' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          Save
        </button>
      </div>

      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        tone="danger"
        title="Reset to the built-in text?"
        description="Your customised title and description are removed; new On Hold issues use the built-in text again. Issues already sent are not changed."
        confirmLabel="Reset"
        busy={busy === 'reset'}
        onConfirm={() => void reset()}
      />
    </section>
  );
}

// ─── Category dialog ──────────────────────────────────────────────────────────

function CategoryDialog({
  open, editing, onClose, onSaved,
}: {
  open: boolean;
  /** null = a new category. */
  editing: HoldCategoryAdminDto | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  // The parent remounts this dialog (new `key`) on every open, so the form starts from the row.
  const [name, setName] = useState(editing?.name ?? '');
  const [description, setDescription] = useState(editing?.description ?? '');
  const [busy, setBusy] = useState(false);
  const descRef = useRef<HTMLTextAreaElement>(null);

  const trimmedName = name.trim();
  const descriptionProblem = description.trim() ? holdTemplateProblem('description', description) : null;
  const canSave = trimmedName.length >= 2 && !descriptionProblem && !busy;

  async function save() {
    if (!canSave) return;
    setBusy(true);
    try {
      const body = JSON.stringify({ name: trimmedName, description });
      if (editing) {
        await api(`/api/it/store-closing-hold/categories/${editing.id}`, { method: 'PATCH', body });
        toast.success(`"${trimmedName}" updated`);
      } else {
        await api('/api/it/store-closing-hold/categories', { method: 'POST', body });
        toast.success(`"${trimmedName}" added`);
      }
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto rounded-2xl border-slate-200 bg-white sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-slate-900">{editing ? 'Edit category' : 'Add category'}</DialogTitle>
          <DialogDescription className="text-slate-500">
            Employees pick one when they put Open Statement On Hold. The description is what Ops, Finance and IT read in the issue.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <label className="block space-y-1.5">
            <span className="text-xs font-bold text-slate-600">Category name</span>
            <input
              autoFocus
              value={name}
              maxLength={HOLD_CATEGORY_NAME_MAX}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Selisih nominal EDC / Z-Report"
              className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm focus:border-cyan-400 focus:outline-none"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="flex items-center justify-between text-xs font-bold text-slate-600">
              Issue description <span className="font-medium text-slate-400">(optional)</span>
              <span className="font-semibold tabular-nums text-slate-400">{description.length}/{HOLD_DESCRIPTION_MAX}</span>
            </span>
            <textarea
              ref={descRef}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={8}
              placeholder="Leave empty to use the default issue text."
              className="w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-[13px] leading-relaxed focus:border-cyan-400 focus:outline-none"
            />
            {descriptionProblem && <span className="block text-[11px] font-semibold text-rose-600">{descriptionProblem}</span>}
          </label>

          <div className="space-y-1.5">
            <p className="text-xs font-bold text-slate-600">Placeholders <span className="font-medium text-slate-400">— click to insert</span></p>
            <PlaceholderChips onInsert={(n) => insertAtCursor(descRef.current, description, n, setDescription)} />
          </div>

          {description.trim() && !descriptionProblem && <IssuePreview description={description} />}
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-500"
          >
            <X className="h-3.5 w-3.5" /> Cancel
          </button>
          <button
            type="button"
            disabled={!canSave}
            onClick={save}
            className="flex h-9 items-center gap-1.5 rounded-lg bg-cyan-600 px-3 text-xs font-bold text-white disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            Save
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Category row ─────────────────────────────────────────────────────────────

function IconButton({
  label, onClick, disabled, className, children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={cn('flex h-8 w-8 items-center justify-center rounded-lg transition disabled:opacity-40', className)}
    >
      {children}
    </button>
  );
}

function CategoryItem({
  category, isFirst, isLast, busy, onMove, onEdit, onToggleActive, onDelete,
}: {
  category: HoldCategoryAdminDto;
  isFirst: boolean;
  isLast: boolean;
  busy: boolean;
  onMove: (dir: -1 | 1) => void;
  onEdit: () => void;
  onToggleActive: () => void;
  onDelete: () => void;
}) {
  return (
    <li
      className={cn(
        'flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5 md:flex-nowrap',
        !category.isActive && 'bg-slate-50/70',
      )}
    >
      <div className="flex shrink-0 flex-col">
        <button
          type="button"
          aria-label="Move up"
          disabled={isFirst || busy}
          onClick={() => onMove(-1)}
          className="flex h-5 w-6 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-30"
        >
          <ChevronUp className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label="Move down"
          disabled={isLast || busy}
          onClick={() => onMove(1)}
          className="flex h-5 w-6 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-30"
        >
          <ChevronDown className="h-4 w-4" />
        </button>
      </div>

      <div className="min-w-0 flex-1 basis-56">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className={cn('text-sm font-bold', category.isActive ? 'text-slate-900' : 'text-slate-400')}>
            {category.name}
          </p>
          {!category.isActive && (
            <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">Hidden</span>
          )}
          {category.description && (
            <span className="rounded-md bg-cyan-50 px-1.5 py-0.5 text-[10px] font-bold text-cyan-700">Own description</span>
          )}
        </div>
        <p className="mt-0.5 line-clamp-2 whitespace-pre-line text-xs text-slate-500">
          {category.description ?? <span className="italic text-slate-400">Uses the default issue text.</span>}
        </p>
      </div>

      <p className="shrink-0 text-[11px] font-semibold tabular-nums text-slate-400 md:w-24 md:text-right">
        {category.usageCount} closing{category.usageCount === 1 ? '' : 's'}
      </p>

      <div className="flex shrink-0 items-center gap-1">
        <IconButton label="Edit" onClick={onEdit} disabled={busy} className="bg-cyan-50 text-cyan-600">
          <Pencil className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton
          label={category.isActive ? 'Shown to employees — click to hide' : 'Hidden — click to show'}
          onClick={onToggleActive}
          disabled={busy}
          className={category.isActive ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'}
        >
          {category.isActive ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
        </IconButton>
        <IconButton label="Delete" onClick={onDelete} disabled={busy} className="bg-rose-50 text-rose-500">
          <Trash2 className="h-4 w-4" />
        </IconButton>
      </div>
    </li>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ItStoreClosingHoldPage() {
  const { status: authStatus, data: session } = useSession();
  const router = useRouter();
  const isIt = session?.user?.role === 'it';

  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogKey, setDialogKey] = useState(0);
  const [editing, setEditing] = useState<HoldCategoryAdminDto | null>(null);
  const [deleting, setDeleting] = useState<HoldCategoryAdminDto | null>(null);

  useEffect(() => {
    if (authStatus === 'loading') return;
    if (!session) { router.replace('/login'); return; }
    if (!isIt) router.replace('/it');
  }, [authStatus, session, isIt, router]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const json = await api('/api/it/store-closing-hold');
      setOverview({ template: json.template, categories: json.categories });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (isIt) void load(); }, [isIt, load]);

  const categories = overview?.categories ?? [];
  const setCategories = (fn: (cur: HoldCategoryAdminDto[]) => HoldCategoryAdminDto[]) =>
    setOverview((o) => (o ? { ...o, categories: fn(o.categories) } : o));

  async function run(id: number, fn: () => Promise<void>) {
    setBusyId(id);
    try { await fn(); } finally { setBusyId(null); }
  }

  function openDialog(category: HoldCategoryAdminDto | null) {
    setEditing(category);
    setDialogKey((k) => k + 1);
    setDialogOpen(true);
  }

  async function handleMove(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= categories.length) return;
    const prev = categories;
    const next = [...categories];
    [next[index], next[target]] = [next[target], next[index]];
    setCategories(() => next);
    await run(next[target].id, async () => {
      try {
        await api('/api/it/store-closing-hold/categories', {
          method: 'PUT',
          body: JSON.stringify({ ids: next.map((c) => c.id) }),
        });
      } catch (e) {
        setCategories(() => prev);
        toast.error(e instanceof Error ? e.message : 'Could not reorder');
      }
    });
  }

  async function handleToggleActive(category: HoldCategoryAdminDto) {
    const isActive = !category.isActive;
    const prev = categories;
    setCategories((cur) => cur.map((c) => (c.id === category.id ? { ...c, isActive } : c)));
    await run(category.id, async () => {
      try {
        await api(`/api/it/store-closing-hold/categories/${category.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ isActive }),
        });
        toast.success(isActive ? `"${category.name}" shown to employees` : `"${category.name}" hidden from employees`);
      } catch (e) {
        setCategories(() => prev);
        toast.error(e instanceof Error ? e.message : 'Could not change visibility');
      }
    });
  }

  async function handleDelete(category: HoldCategoryAdminDto) {
    await run(category.id, async () => {
      try {
        await api(`/api/it/store-closing-hold/categories/${category.id}`, { method: 'DELETE' });
        setCategories((cur) => cur.filter((c) => c.id !== category.id));
        toast.success(`"${category.name}" deleted`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Could not delete');
      } finally {
        setDeleting(null);
      }
    });
  }

  // One click fills an empty list with a starter set to edit — same endpoint as "Add category".
  async function addStarterSet() {
    setSeeding(true);
    try {
      for (const c of STARTER_HOLD_CATEGORIES) {
        await api('/api/it/store-closing-hold/categories', {
          method: 'POST',
          body: JSON.stringify({ name: c.name, description: c.description ?? '' }),
        });
      }
      toast.success('Starter categories added — edit them to fit your process');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not add the starter set');
    } finally {
      setSeeding(false);
      void load();
    }
  }

  if (authStatus === 'loading' || !session) return (
    <div className="flex min-h-full items-center justify-center bg-slate-50">
      <Loader2 className="h-6 w-6 animate-spin text-cyan-400" />
    </div>
  );

  if (!isIt) return (
    <div className="flex min-h-full flex-col items-center justify-center gap-4 bg-slate-50 p-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50"><Shield className="h-8 w-8 text-red-500" /></div>
      <p className="text-base font-bold text-slate-800">Access Restricted</p>
      <p className="text-sm text-slate-500">Only IT can manage the On Hold setup.</p>
    </div>
  );

  const activeCount = categories.filter((c) => c.isActive).length;

  return (
    <div className="min-h-full bg-slate-50">
      <PanelPageHeader
        scope="IT"
        title="On Hold Statement"
        subtitle={<>Store Closing · {categories.length} categor{categories.length === 1 ? 'y' : 'ies'} · {activeCount} shown to employees</>}
        actions={
          <Link
            href="/it"
            className="flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-600 hover:bg-slate-50"
          >
            <ArrowLeft className="h-4 w-4" />
            Dashboard
          </Link>
        }
      />

      <div className="space-y-5 px-4 py-5 sm:px-6 lg:px-8">
        {loading && !overview ? (
          <div className="space-y-3">
            <div className="h-64 animate-pulse rounded-2xl bg-slate-100" />
            <div className="h-40 animate-pulse rounded-2xl bg-slate-100" />
          </div>
        ) : overview && (
          <>
            <DefaultTemplateCard
              // Remount after a save / reset so the form starts from the stored text.
              key={overview.template.updatedAt ?? 'built-in'}
              state={overview.template}
              onSaved={(template) => setOverview((o) => (o ? { ...o, template } : o))}
            />

            <section className="space-y-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900">Categories</h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  When at least one category is shown, employees must pick one (and still write a reason) before the On Hold report can be sent.
                  With none shown, the report only asks for the reason. The order here is the order on the Store Closing page.
                </p>
              </div>

              <button
                type="button"
                onClick={() => openDialog(null)}
                className="flex w-full items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-slate-200 py-3 text-xs font-bold text-slate-500 transition hover:bg-white"
              >
                <Plus className="h-3.5 w-3.5" /> Add category
              </button>

              {categories.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center">
                  <PauseCircle className="mx-auto h-8 w-8 text-slate-300" />
                  <p className="mt-3 text-sm font-semibold text-slate-700">No categories yet</p>
                  <p className="mt-1 text-xs text-slate-400">
                    Employees only write a reason for now. Add your own, or start from a few examples and edit them.
                  </p>
                  <button
                    type="button"
                    onClick={() => void addStarterSet()}
                    disabled={seeding}
                    className="mx-auto mt-4 flex h-9 items-center gap-1.5 rounded-lg border border-cyan-200 bg-cyan-50 px-3 text-xs font-bold text-cyan-700 hover:bg-cyan-100 disabled:opacity-60"
                  >
                    {seeding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                    Add example categories
                  </button>
                </div>
              ) : (
                <OpsList>
                  {categories.map((c, i) => (
                    <CategoryItem
                      key={c.id}
                      category={c}
                      isFirst={i === 0}
                      isLast={i === categories.length - 1}
                      busy={busyId !== null}
                      onMove={(dir) => void handleMove(i, dir)}
                      onEdit={() => openDialog(c)}
                      onToggleActive={() => void handleToggleActive(c)}
                      onDelete={() => setDeleting(c)}
                    />
                  ))}
                </OpsList>
              )}
            </section>
          </>
        )}
      </div>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => { if (!open) setDeleting(null); }}
        tone="danger"
        title={`Delete "${deleting?.name ?? ''}"?`}
        description={
          deleting && deleting.usageCount > 0 ? (
            <>
              {deleting.usageCount} closing{deleting.usageCount === 1 ? '' : 's'} picked this category — they keep its name.
              To just stop offering it, hide it with the eye button instead.
            </>
          ) : (
            'This category disappears from the Store Closing page.'
          )
        }
        confirmLabel="Delete"
        busy={deleting !== null && busyId === deleting.id}
        onConfirm={() => { if (deleting) void handleDelete(deleting); }}
      />

      <CategoryDialog
        key={dialogKey}
        open={dialogOpen}
        editing={editing}
        onClose={() => setDialogOpen(false)}
        onSaved={() => void load()}
      />
    </div>
  );
}
