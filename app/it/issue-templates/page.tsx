'use client';
// app/it/issue-templates/page.tsx — IT only.
//
// Issue templates ("report presets"): common problems with a ready title,
// description and the teams they go to. In "Report an Issue" an employee taps a
// template and the form is pre-filled (everything stays editable). Inactive
// templates are hidden from employees.

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Check, ClipboardList, Eye, EyeOff, Loader2, Pencil, Plus, Shield, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import OpsPageHeader from '@/components/ops/layout/OpsPageHeader';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  ISSUE_DESCRIPTION_MAX,
  ISSUE_TEMPLATE_NAME_MAX,
  ISSUE_TITLE_MAX,
  type IssueTemplateDto,
} from '@/lib/issue-templates';

type RoleOption = { id: number; code: string; label: string };
type Draft = { name: string; title: string; description: string; assignedRoleIds: number[] };

const EMPTY_DRAFT: Draft = { name: '', title: '', description: '', assignedRoleIds: [] };

async function api(url: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.success) throw new Error(json.error ?? 'Request failed');
  return json;
}

// ─── Create / edit dialog ─────────────────────────────────────────────────────

function TemplateDialog({
  open, editing, roles, onClose, onSaved,
}: {
  open: boolean;
  /** null = creating a new template. */
  editing: IssueTemplateDto | null;
  roles: RoleOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  // The parent remounts this dialog (new `key`) on every open.
  const [draft, setDraft] = useState<Draft>(() =>
    editing
      ? {
          name: editing.name,
          title: editing.title ?? '',
          description: editing.description ?? '',
          assignedRoleIds: editing.assignedRoleIds,
        }
      : EMPTY_DRAFT,
  );
  const [busy, setBusy] = useState(false);

  const name = draft.name.trim();
  const title = draft.title.trim();
  const description = draft.description.trim();
  const canSave = name.length >= 2 && (title.length >= 3 || description.length > 0) && !busy;

  const toggleRole = (id: number) =>
    setDraft((d) => ({
      ...d,
      assignedRoleIds: d.assignedRoleIds.includes(id)
        ? d.assignedRoleIds.filter((r) => r !== id)
        : [...d.assignedRoleIds, id],
    }));

  async function save() {
    if (!canSave) return;
    setBusy(true);
    try {
      const body = JSON.stringify({ name, title, description, assignedRoleIds: draft.assignedRoleIds });
      if (editing) {
        await api(`/api/it/issue-templates/${editing.id}`, { method: 'PATCH', body });
        toast.success(`Template "${name}" updated`);
      } else {
        await api('/api/it/issue-templates', { method: 'POST', body });
        toast.success(`Template "${name}" added`);
      }
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save the template');
    } finally {
      setBusy(false);
    }
  }

  const field = 'w-full rounded-lg border border-slate-200 bg-white px-3 text-sm focus:border-cyan-400 focus:outline-none';

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto rounded-2xl border-slate-200 bg-white sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-slate-900">{editing ? 'Edit template' : 'Add template'}</DialogTitle>
          <DialogDescription className="text-slate-500">
            Employees pick it in &ldquo;Report an Issue&rdquo; and the form is filled in for them.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <label className="block space-y-1.5">
            <span className="text-xs font-bold text-slate-600">Template name</span>
            <input
              autoFocus
              value={draft.name}
              maxLength={ISSUE_TEMPLATE_NAME_MAX}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder="e.g. Printer kasir rusak"
              className={cn(field, 'h-10')}
            />
            <span className="block text-[11px] text-slate-400">The label on the chip employees tap.</span>
          </label>

          <label className="block space-y-1.5">
            <span className="flex items-center justify-between text-xs font-bold text-slate-600">
              Issue title
              <span className="font-semibold tabular-nums text-slate-400">{draft.title.length}/{ISSUE_TITLE_MAX}</span>
            </span>
            <input
              value={draft.title}
              maxLength={ISSUE_TITLE_MAX}
              onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
              placeholder="e.g. Printer kasir tidak bisa mencetak struk"
              className={cn(field, 'h-10')}
            />
          </label>

          <label className="block space-y-1.5">
            <span className="flex items-center justify-between text-xs font-bold text-slate-600">
              Description
              <span className="font-semibold tabular-nums text-slate-400">{draft.description.length}/{ISSUE_DESCRIPTION_MAX}</span>
            </span>
            <textarea
              value={draft.description}
              maxLength={ISSUE_DESCRIPTION_MAX}
              onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
              rows={6}
              placeholder="Pre-filled text, e.g. which questions the employee should answer (what happened, since when, which device…)."
              className={cn(field, 'resize-none py-2')}
            />
            <span className="block text-[11px] text-slate-400">Fill in at least a title or a description.</span>
          </label>

          <div className="space-y-1.5">
            <span className="text-xs font-bold text-slate-600">Send to</span>
            <div className="flex flex-wrap gap-2">
              {roles.map((role) => {
                const on = draft.assignedRoleIds.includes(role.id);
                return (
                  <button
                    key={role.id}
                    type="button"
                    onClick={() => toggleRole(role.id)}
                    className={cn(
                      'flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-bold transition-colors',
                      on ? 'border-cyan-500 bg-cyan-50 text-cyan-700' : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300',
                    )}
                  >
                    {on && <Check className="h-3 w-3" />}
                    {role.label}
                  </button>
                );
              })}
            </div>
            <span className="block text-[11px] text-slate-400">
              Pre-selected for the employee (they can change it). None = the form keeps its usual default.
            </span>
          </div>
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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function IssueTemplatesPage() {
  const { data: session, status: authStatus } = useSession();
  const router = useRouter();
  const isIt = session?.user?.role === 'it';

  const [templates, setTemplates] = useState<IssueTemplateDto[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogKey, setDialogKey] = useState(0);
  const [editing, setEditing] = useState<IssueTemplateDto | null>(null);
  const [deleting, setDeleting] = useState<IssueTemplateDto | null>(null);

  useEffect(() => {
    if (authStatus === 'loading') return;
    if (!session) { router.replace('/login'); return; }
    if (!isIt) router.replace('/it');
  }, [authStatus, session, isIt, router]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const json = await api('/api/it/issue-templates');
      setTemplates(json.templates);
      setRoles(json.roles);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load the templates');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (isIt) void load(); }, [isIt, load]);

  function openDialog(template: IssueTemplateDto | null) {
    setEditing(template);
    setDialogKey((k) => k + 1);
    setDialogOpen(true);
  }

  async function toggleActive(template: IssueTemplateDto) {
    const isActive = !template.isActive;
    setBusyId(template.id);
    try {
      await api(`/api/it/issue-templates/${template.id}`, { method: 'PATCH', body: JSON.stringify({ isActive }) });
      setTemplates((cur) => cur.map((t) => (t.id === template.id ? { ...t, isActive } : t)));
      toast.success(isActive ? `"${template.name}" is shown to employees` : `"${template.name}" is hidden from employees`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to change visibility');
    } finally {
      setBusyId(null);
    }
  }

  async function remove(template: IssueTemplateDto) {
    setBusyId(template.id);
    try {
      await api(`/api/it/issue-templates/${template.id}`, { method: 'DELETE' });
      setTemplates((cur) => cur.filter((t) => t.id !== template.id));
      toast.success(`Template "${template.name}" deleted`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete the template');
    } finally {
      setBusyId(null);
      setDeleting(null);
    }
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
      <p className="text-sm text-slate-500">Only IT can manage issue templates.</p>
    </div>
  );

  const roleLabel = (id: number) => roles.find((r) => r.id === id)?.label ?? `#${id}`;
  const activeCount = templates.filter((t) => t.isActive).length;

  return (
    <div className="min-h-full bg-slate-50">
      <OpsPageHeader
        scope="IT · Configuration"
        title="Issue Templates"
        subtitle={loading ? 'Loading…' : `${templates.length} template${templates.length !== 1 ? 's' : ''} · ${activeCount} shown to employees`}
        onRefresh={() => void load()}
        refreshing={loading}
      />

      <div className="space-y-3 px-4 py-5 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-slate-500">
            Ready-made reports employees can pick when they report an issue. They can still change everything.
          </p>
          <button
            type="button"
            onClick={() => openDialog(null)}
            className="flex h-9 items-center gap-1.5 rounded-lg bg-cyan-600 px-3 text-xs font-bold text-white"
          >
            <Plus className="h-3.5 w-3.5" /> Add template
          </button>
        </div>

        {loading && templates.length === 0 ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-cyan-400" /></div>
        ) : templates.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center">
            <ClipboardList className="mx-auto h-8 w-8 text-slate-300" />
            <p className="mt-3 text-sm font-semibold text-slate-700">No templates yet</p>
            <p className="mt-1 text-xs text-slate-500">Until you add one, employees fill in the issue form from scratch.</p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            {templates.map((t) => (
              <li key={t.id} className={cn('flex flex-wrap items-start gap-3 p-4', !t.isActive && 'bg-slate-50/70')}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className={cn('text-sm font-bold', t.isActive ? 'text-slate-900' : 'text-slate-400')}>{t.name}</p>
                    {!t.isActive && (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">Hidden</span>
                    )}
                    {t.assignedRoleIds.map((id) => (
                      <span key={id} className="rounded-full bg-cyan-50 px-2 py-0.5 text-[10px] font-bold text-cyan-700">
                        {roleLabel(id)}
                      </span>
                    ))}
                  </div>
                  {t.title && <p className="mt-1 text-xs font-semibold text-slate-700">{t.title}</p>}
                  {t.description && <p className="mt-0.5 line-clamp-2 whitespace-pre-line text-xs text-slate-500">{t.description}</p>}
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    disabled={busyId === t.id}
                    onClick={() => void toggleActive(t)}
                    title={t.isActive ? 'Hide from employees' : 'Show to employees'}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-50"
                  >
                    {t.isActive ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => openDialog(t)}
                    title="Edit"
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleting(t)}
                    title="Delete"
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-rose-500 hover:bg-rose-50"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <TemplateDialog
        key={dialogKey}
        open={dialogOpen}
        editing={editing}
        roles={roles}
        onClose={() => setDialogOpen(false)}
        onSaved={() => void load()}
      />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => { if (!open) setDeleting(null); }}
        title={`Delete "${deleting?.name ?? ''}"?`}
        description="Issues already reported from this template are not affected."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        tone="danger"
        busy={busyId !== null}
        onConfirm={() => { if (deleting) void remove(deleting); }}
      />
    </div>
  );
}
