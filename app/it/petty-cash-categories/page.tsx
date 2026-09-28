'use client';
// app/it/petty-cash-categories/page.tsx — IT only.
//
// Manage the categories a PIC picks when requesting petty cash (Galon, ATK, …,
// Lain-Lain): add, edit the default reason that pre-fills the request's
// Keterangan, mark a category as "PIC writes their own reason", hide, reorder,
// delete. Employees see the active ones via GET /api/employee/petty-cash.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import {
  ArrowLeft, Check, ChevronDown, ChevronUp, Eye, EyeOff, Loader2, Pencil, Plus,
  Shield, Tags, Trash2, X,
} from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
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
  PETTY_CASH_CATEGORY_NAME_MAX,
  PETTY_CASH_REASON_MAX,
} from '@/lib/petty-cash-categories';

// ─── Types ────────────────────────────────────────────────────────────────────

type CategoryRow = {
  id: number;
  name: string;
  defaultReason: string | null;
  requiresCustomReason: boolean;
  isActive: boolean;
  sortOrder: number;
  usageCount: number;
};

type Draft = { name: string; defaultReason: string; requiresCustomReason: boolean };

const EMPTY_DRAFT: Draft = { name: '', defaultReason: '', requiresCustomReason: false };

async function api(url: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.success) throw new Error(json.error ?? 'Request gagal');
  return json;
}

// ─── Create / edit dialog ─────────────────────────────────────────────────────

function CategoryDialog({
  open, editing, onClose, onSaved,
}: {
  open: boolean;
  /** null = creating a new category. */
  editing: CategoryRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  // The parent remounts this dialog (new `key`) on every open, so the form
  // always starts from the row being edited, or blank for "add".
  const [draft, setDraft] = useState<Draft>(() =>
    editing
      ? {
          name: editing.name,
          defaultReason: editing.defaultReason ?? '',
          requiresCustomReason: editing.requiresCustomReason,
        }
      : EMPTY_DRAFT,
  );
  const [busy, setBusy] = useState(false);

  const name = draft.name.trim();
  const reason = draft.defaultReason.trim();
  const canSave = name.length >= 2 && (draft.requiresCustomReason || reason.length > 0) && !busy;

  async function save() {
    if (!canSave) return;
    setBusy(true);
    try {
      const body = JSON.stringify({
        name,
        defaultReason: draft.requiresCustomReason ? '' : reason,
        requiresCustomReason: draft.requiresCustomReason,
      });
      if (editing) {
        await api(`/api/ops/petty-cash/categories/${editing.id}`, { method: 'PATCH', body });
        toast.success(`Kategori "${name}" diperbarui`);
      } else {
        await api('/api/ops/petty-cash/categories', { method: 'POST', body });
        toast.success(`Kategori "${name}" ditambahkan`);
      }
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal menyimpan kategori');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="rounded-2xl border-slate-200 bg-white sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-slate-900">
            {editing ? 'Edit kategori' : 'Tambah kategori'}
          </DialogTitle>
          <DialogDescription className="text-slate-500">
            Kategori tampil di form Request Petty Cash milik PIC.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <label className="block space-y-1.5">
            <span className="text-xs font-bold text-slate-600">Nama kategori</span>
            <input
              autoFocus
              value={draft.name}
              maxLength={PETTY_CASH_CATEGORY_NAME_MAX}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder="mis. Galon"
              className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm focus:border-cyan-400 focus:outline-none"
            />
          </label>

          <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <input
              type="checkbox"
              checked={draft.requiresCustomReason}
              onChange={(e) => setDraft((d) => ({ ...d, requiresCustomReason: e.target.checked }))}
              className="mt-0.5 h-4 w-4 accent-cyan-600"
            />
            <span>
              <span className="block text-sm font-semibold text-slate-800">PIC menulis alasan sendiri</span>
              <span className="block text-xs text-slate-500">
                Untuk kategori seperti Lain-Lain — tanpa alasan default, Keterangan wajib diisi PIC.
              </span>
            </span>
          </label>

          {!draft.requiresCustomReason && (
            <label className="block space-y-1.5">
              <span className="flex items-center justify-between text-xs font-bold text-slate-600">
                Alasan default
                <span className="font-semibold tabular-nums text-slate-400">
                  {draft.defaultReason.length}/{PETTY_CASH_REASON_MAX}
                </span>
              </span>
              <textarea
                value={draft.defaultReason}
                maxLength={PETTY_CASH_REASON_MAX}
                onChange={(e) => setDraft((d) => ({ ...d, defaultReason: e.target.value }))}
                rows={4}
                placeholder="Mengisi Keterangan otomatis saat PIC memilih kategori ini."
                className="w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-cyan-400 focus:outline-none"
              />
              <span className="block text-[11px] text-slate-400">
                PIC tetap bisa mengubah atau menambah detail sebelum mengirim.
              </span>
            </label>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-500"
          >
            <X className="h-3.5 w-3.5" /> Batal
          </button>
          <button
            type="button"
            disabled={!canSave}
            onClick={save}
            className="flex h-9 items-center gap-1.5 rounded-lg bg-cyan-600 px-3 text-xs font-bold text-white disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            Simpan
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Row ──────────────────────────────────────────────────────────────────────

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
      className={cn(
        'flex h-8 w-8 items-center justify-center rounded-lg transition disabled:opacity-40',
        className,
      )}
    >
      {children}
    </button>
  );
}

function CategoryItem({
  category, isFirst, isLast, busy, onMove, onEdit, onToggleActive, onDelete,
}: {
  category: CategoryRow;
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
          aria-label="Naikkan"
          disabled={isFirst || busy}
          onClick={() => onMove(-1)}
          className="flex h-5 w-6 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-30"
        >
          <ChevronUp className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label="Turunkan"
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
          {category.requiresCustomReason && (
            <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
              Alasan ditulis PIC
            </span>
          )}
          {!category.isActive && (
            <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">
              Disembunyikan
            </span>
          )}
        </div>
        <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">
          {category.requiresCustomReason ? (
            <span className="italic">PIC wajib menulis Keterangan sendiri.</span>
          ) : (
            category.defaultReason
          )}
        </p>
      </div>

      <p className="shrink-0 text-[11px] font-semibold tabular-nums text-slate-400 md:w-24 md:text-right">
        {category.usageCount} request
      </p>

      <div className="flex shrink-0 items-center gap-1">
        <IconButton label="Edit" onClick={onEdit} disabled={busy} className="bg-cyan-50 text-cyan-600">
          <Pencil className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton
          label={category.isActive ? 'Tampil di form PIC — klik untuk sembunyikan' : 'Disembunyikan — klik untuk tampilkan'}
          onClick={onToggleActive}
          disabled={busy}
          className={category.isActive ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'}
        >
          {category.isActive ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
        </IconButton>
        <IconButton label="Hapus" onClick={onDelete} disabled={busy} className="bg-rose-50 text-rose-500">
          <Trash2 className="h-4 w-4" />
        </IconButton>
      </div>
    </li>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ItPettyCashCategoriesPage() {
  const { status: authStatus, data: session } = useSession();
  const router = useRouter();
  const isIt = session?.user?.role === 'it';

  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogKey, setDialogKey] = useState(0);
  const [editing, setEditing] = useState<CategoryRow | null>(null);
  const [deleting, setDeleting] = useState<CategoryRow | null>(null);

  useEffect(() => {
    if (authStatus === 'loading') return;
    if (!session) { router.replace('/login'); return; }
    if (!isIt) router.replace('/it');
  }, [authStatus, session, isIt, router]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const json = await api('/api/ops/petty-cash/categories');
      setCategories(json.categories);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal memuat kategori');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (isIt) void load(); }, [isIt, load]);

  async function run(id: number, fn: () => Promise<void>) {
    setBusyId(id);
    try {
      await fn();
    } finally {
      setBusyId(null);
    }
  }

  function openDialog(category: CategoryRow | null) {
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
    setCategories(next);
    await run(next[target].id, async () => {
      try {
        await api('/api/ops/petty-cash/categories', {
          method: 'PUT',
          body: JSON.stringify({ ids: next.map((c) => c.id) }),
        });
      } catch (e) {
        setCategories(prev);
        toast.error(e instanceof Error ? e.message : 'Gagal mengubah urutan');
      }
    });
  }

  async function handleToggleActive(category: CategoryRow) {
    const isActive = !category.isActive;
    const prev = categories;
    setCategories((cur) => cur.map((c) => (c.id === category.id ? { ...c, isActive } : c)));
    await run(category.id, async () => {
      try {
        await api(`/api/ops/petty-cash/categories/${category.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ isActive }),
        });
        toast.success(isActive ? `"${category.name}" ditampilkan ke PIC` : `"${category.name}" disembunyikan dari PIC`);
      } catch (e) {
        setCategories(prev);
        toast.error(e instanceof Error ? e.message : 'Gagal mengubah visibilitas');
      }
    });
  }

  // Runs once the delete is confirmed in the modal.
  async function handleDelete(category: CategoryRow) {
    await run(category.id, async () => {
      try {
        await api(`/api/ops/petty-cash/categories/${category.id}`, { method: 'DELETE' });
        setCategories((cur) => cur.filter((c) => c.id !== category.id));
        setDeleting(null);
        toast.success(`Kategori "${category.name}" dihapus`);
      } catch (e) {
        setDeleting(null);
        toast.error(e instanceof Error ? e.message : 'Gagal menghapus kategori');
      }
    });
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
      <p className="text-sm text-slate-500">Only IT can manage petty cash categories.</p>
    </div>
  );

  const activeCount = categories.filter((c) => c.isActive).length;

  return (
    <div className="min-h-full bg-slate-50">
      <div className="border-b border-slate-200 bg-white px-6 py-5 lg:px-8">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-cyan-600">IT</p>
            <h1 className="text-xl font-bold text-slate-900">Kategori Petty Cash</h1>
            <p className="mt-0.5 text-xs text-slate-400">
              {categories.length} kategori · {activeCount} tampil di form Request PIC
            </p>
          </div>
          <Link
            href="/it"
            className="flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-600 hover:bg-slate-50"
          >
            <ArrowLeft className="h-4 w-4" />
            Dashboard
          </Link>
        </div>
      </div>

      <div className="mx-auto max-w-4xl space-y-3 px-4 py-5 sm:px-6 lg:px-8">
        <p className="text-xs text-slate-500">
          PIC memilih kategori saat mengirim Request Petty Cash. Alasan default mengisi Keterangan
          otomatis (PIC masih bisa mengubahnya); kategori bertanda <span className="font-semibold text-amber-700">Alasan ditulis PIC</span> wajib
          diisi sendiri. Urutan di sini = urutan di form PIC.
        </p>

        <button
          type="button"
          onClick={() => openDialog(null)}
          className="flex w-full items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-slate-200 py-3 text-xs font-bold text-slate-500 transition hover:bg-white"
        >
          <Plus className="h-3.5 w-3.5" /> Tambah kategori
        </button>

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-16 animate-pulse rounded-2xl bg-slate-100" />)}
          </div>
        ) : categories.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center">
            <Tags className="mx-auto h-8 w-8 text-slate-300" />
            <p className="mt-3 text-sm font-semibold text-slate-700">Belum ada kategori</p>
            <p className="mt-1 text-xs text-slate-400">PIC tidak bisa mengirim Request sampai ada kategori aktif.</p>
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
      </div>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => { if (!open) setDeleting(null); }}
        tone="danger"
        title={`Hapus kategori "${deleting?.name ?? ''}"?`}
        description={
          deleting && deleting.usageCount > 0 ? (
            <>
              Kategori ini sudah dipakai di {deleting.usageCount} request — request lama tetap menyimpan
              nama kategorinya. Untuk sekadar menyembunyikan dari PIC, gunakan tombol mata.
            </>
          ) : (
            'Kategori ini akan hilang dari form Request PIC.'
          )
        }
        confirmLabel="Hapus"
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
