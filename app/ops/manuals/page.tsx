'use client';
// app/ops/manuals/page.tsx — OPS HO only.
//
// Knowledge Manual admin: upload store-operations manuals (PDF/Word/Excel/
// image), toggle visibility, edit metadata, delete. Employees see only the
// active ones via GET /api/employee/manuals.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import {
  BookOpen, Loader2, Shield, UploadCloud, FileText, FileSpreadsheet,
  Image as ImageIcon, Trash2, Eye, EyeOff, Pencil, Check, X, Plus,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import OpsPageHeader from '@/components/ops/layout/OpsPageHeader';

// ─── Auth guard ───────────────────────────────────────────────────────────────

function useIsOpsHo() {
  const { data: session } = useSession();
  return session?.user?.isOpsHo === true || session?.user?.role === 'it';
}

// ─── Types ────────────────────────────────────────────────────────────────────

type ManualRow = {
  id: string;
  title: string;
  description: string | null;
  fileUrl: string;
  fileType: string;
  isActive: boolean;
  sortOrder: number;
  uploaderName: string | null;
  createdAt: string;
};

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp']);
const SHEET_EXTS = new Set(['xls', 'xlsx']);

function fileIcon(fileType: string) {
  const ext = fileType.toLowerCase();
  if (IMAGE_EXTS.has(ext)) return { Icon: ImageIcon, color: 'text-sky-500', bg: 'bg-sky-50' };
  if (SHEET_EXTS.has(ext)) return { Icon: FileSpreadsheet, color: 'text-emerald-500', bg: 'bg-emerald-50' };
  return { Icon: FileText, color: 'text-rose-500', bg: 'bg-rose-50' };
}

// ─── New manual upload form ─────────────────────────────────────────────────

function NewManualForm({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setTitle('');
    setDescription('');
    setFile(null);
    setOpen(false);
  }

  async function handleSubmit() {
    if (!title.trim() || !file) {
      toast.error('Title and file are required.');
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('title', title.trim());
      const uploadRes = await fetch('/api/upload/manual', { method: 'POST', body: form });
      const uploadJson = await uploadRes.json();
      if (!uploadRes.ok) throw new Error(uploadJson.error ?? 'Upload failed');

      const createRes = await fetch('/api/ops/manuals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || undefined,
          fileUrl: uploadJson.url,
          fileType: uploadJson.fileType,
        }),
      });
      const createJson = await createRes.json();
      if (!createRes.ok || !createJson.success) throw new Error(createJson.error ?? 'Failed to save manual');

      toast.success(`"${title.trim()}" uploaded`);
      reset();
      onCreated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to upload manual');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-slate-200 py-3 text-xs font-bold text-slate-500 transition hover:bg-slate-50"
      >
        <Plus className="h-3.5 w-3.5" /> Upload manual baru
      </button>
    );
  }

  return (
    <div className="space-y-3 rounded-2xl border border-indigo-200 bg-indigo-50 p-4">
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Judul manual (mis. SOP Store Opening)"
        className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm focus:border-indigo-400 focus:outline-none"
      />
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Deskripsi singkat (opsional)"
        rows={2}
        className="w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none"
      />

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx"
        className="hidden"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        className="flex w-full items-center gap-2 rounded-lg border border-dashed border-slate-300 bg-white px-3 py-2.5 text-left text-xs font-semibold text-slate-500 hover:bg-slate-50"
      >
        <UploadCloud className="h-4 w-4 shrink-0 text-slate-400" />
        {file ? file.name : 'Pilih file (PDF, Word, Excel, atau gambar)'}
      </button>

      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={reset}
          className="flex h-9 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-500"
        >
          <X className="h-3.5 w-3.5" /> Batal
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={handleSubmit}
          className="flex h-9 items-center gap-1.5 rounded-lg bg-indigo-600 px-3 text-xs font-bold text-white disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          Simpan
        </button>
      </div>
    </div>
  );
}

// ─── Manual card ──────────────────────────────────────────────────────────────

function ManualCard({
  manual, busy, onToggleActive, onRename, onDelete,
}: {
  manual: ManualRow;
  busy: boolean;
  onToggleActive: (id: string, isActive: boolean) => void;
  onRename: (id: string, title: string, description: string) => void;
  onDelete: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState(manual.title);
  const [descDraft, setDescDraft] = useState(manual.description ?? '');
  const { Icon, color, bg } = fileIcon(manual.fileType);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', bg)}>
          <Icon className={cn('h-4.5 w-4.5', color)} />
        </div>

        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="space-y-1.5">
              <input
                autoFocus
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                className="h-8 w-full rounded-lg border border-indigo-300 bg-white px-2 text-sm font-bold text-slate-900 focus:outline-none"
              />
              <textarea
                value={descDraft}
                onChange={(e) => setDescDraft(e.target.value)}
                rows={2}
                className="w-full resize-none rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-600 focus:outline-none"
              />
              <div className="flex justify-end gap-1.5">
                <button
                  type="button"
                  onClick={() => { setTitleDraft(manual.title); setDescDraft(manual.description ?? ''); setEditing(false); }}
                  className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => { if (titleDraft.trim()) { onRename(manual.id, titleDraft.trim(), descDraft.trim()); setEditing(false); } }}
                  className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 text-white"
                >
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-1.5">
                <p className="truncate text-sm font-bold text-slate-900">{manual.title}</p>
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-300 hover:bg-slate-100 hover:text-slate-500"
                >
                  <Pencil className="h-3 w-3" />
                </button>
              </div>
              {manual.description && (
                <p className="mt-0.5 truncate text-xs text-slate-500">{manual.description}</p>
              )}
              <p className="mt-1 text-[10px] text-slate-400">
                {manual.uploaderName ?? '—'} &middot; <span className="uppercase">{manual.fileType}</span>
              </p>
            </>
          )}
        </div>

        {!editing && (
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              disabled={busy}
              onClick={() => onToggleActive(manual.id, !manual.isActive)}
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-lg transition disabled:opacity-50',
                manual.isActive ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400',
              )}
              title={manual.isActive ? 'Visible to employees' : 'Hidden from employees'}
            >
              {manual.isActive ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onDelete(manual.id)}
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-50 text-rose-500 disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function OpsManualsPage() {
  const { status: authStatus, data: session } = useSession();
  const router = useRouter();
  const isOpsHo = useIsOpsHo();

  const [manuals, setManuals] = useState<ManualRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (authStatus === 'loading') return;
    if (!session) { router.replace('/login'); return; }
    if (!isOpsHo) router.replace('/ops');
  }, [authStatus, session, isOpsHo, router]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/ops/manuals', { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? 'Failed to load manuals');
      setManuals(json.manuals);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load manuals');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (isOpsHo) void load(); }, [isOpsHo, load]);

  function withBusy<T>(key: string, fn: () => Promise<T>) {
    setBusy((cur) => new Set(cur).add(key));
    return fn().finally(() => setBusy((cur) => { const next = new Set(cur); next.delete(key); return next; }));
  }

  async function handleToggleActive(id: string, isActive: boolean) {
    const prev = manuals;
    setManuals((cur) => cur.map((m) => (m.id === id ? { ...m, isActive } : m)));
    await withBusy(id, async () => {
      try {
        const res = await fetch(`/api/ops/manuals/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isActive }),
        });
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error ?? 'Failed to update');
      } catch (e) {
        setManuals(prev);
        toast.error(e instanceof Error ? e.message : 'Gagal mengubah visibilitas');
      }
    });
  }

  async function handleRename(id: string, title: string, description: string) {
    const prev = manuals;
    setManuals((cur) => cur.map((m) => (m.id === id ? { ...m, title, description: description || null } : m)));
    await withBusy(id, async () => {
      try {
        const res = await fetch(`/api/ops/manuals/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, description }),
        });
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error ?? 'Failed to update');
        toast.success('Manual diperbarui');
      } catch (e) {
        setManuals(prev);
        toast.error(e instanceof Error ? e.message : 'Gagal memperbarui manual');
      }
    });
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this manual? Employees will no longer see it.')) return;
    const prev = manuals;
    setManuals((cur) => cur.filter((m) => m.id !== id));
    await withBusy(id, async () => {
      try {
        const res = await fetch(`/api/ops/manuals/${id}`, { method: 'DELETE' });
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error ?? 'Failed to delete');
        toast.success('Manual dihapus');
      } catch (e) {
        setManuals(prev);
        toast.error(e instanceof Error ? e.message : 'Gagal menghapus manual');
      }
    });
  }

  if (authStatus === 'loading' || !session) return (
    <div className="flex min-h-full items-center justify-center bg-slate-50">
      <Loader2 className="h-6 w-6 animate-spin text-indigo-400" />
    </div>
  );

  if (!isOpsHo) return (
    <div className="flex min-h-full flex-col items-center justify-center gap-4 bg-slate-50 p-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50"><Shield className="h-8 w-8 text-red-500" /></div>
      <p className="text-base font-bold text-slate-800">Access Restricted</p>
      <p className="text-sm text-slate-500">Only OPS HO can manage manuals.</p>
    </div>
  );

  return (
    <div className="min-h-full bg-slate-50">
      <OpsPageHeader
        scope="OPS · Head Office"
        title="Knowledge Manual"
        subtitle={`${manuals.length} manual · ${manuals.filter((m) => m.isActive).length} visible to employees`}
        onRefresh={() => void load()}
        refreshing={loading}
      />

      <div className="mx-auto space-y-3 px-4 py-5 sm:px-6 lg:px-8">
        <NewManualForm onCreated={load} />

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-20 animate-pulse rounded-2xl bg-slate-100" />)}
          </div>
        ) : manuals.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center">
            <BookOpen className="mx-auto h-8 w-8 text-slate-300" />
            <p className="mt-3 text-sm font-semibold text-slate-700">Belum ada manual</p>
            <p className="mt-1 text-xs text-slate-400">Upload manual pertama untuk mulai membangun perpustakaan pengetahuan.</p>
          </div>
        ) : (
          manuals.map((m) => (
            <ManualCard
              key={m.id}
              manual={m}
              busy={busy.has(m.id)}
              onToggleActive={handleToggleActive}
              onRename={handleRename}
              onDelete={handleDelete}
            />
          ))
        )}
      </div>
    </div>
  );
}
