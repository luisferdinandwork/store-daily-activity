'use client';
// app/it/users/page.tsx — IT user management (create/edit/delete accounts, assign roles).
//
// The list sorts by any column header and filters by role / employee type /
// area / store / status. Stores with more than one active PIC 1 are flagged in
// red — banner, rows, the edit form and the import review — so IT changes the
// extra one (lib/store-pic1.ts); `?pic1=duplicates` opens the list filtered to
// them (Store Management links here). Delete always goes through: the dialog
// previews what is removed and which cash records stay as history (a notice) —
// lib/db/utils/user-deletion.ts. Store pickers are searchable (StoreCombobox).

import { Suspense, useEffect, useState, useCallback, useMemo, useRef, type ReactNode } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import {
  Loader2, Shield, Search, Plus, Pencil, ChevronDown, Trash2, AlertTriangle, Banknote,
  ArrowUp, ArrowDown, ArrowUpDown, FilterX,
  UserCircle2, X, Download, Upload, FileSpreadsheet, CheckCircle2, AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Sheet, SheetContent, SheetTitle, SheetDescription, SheetHeader, SheetFooter } from '@/components/ui/sheet';
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { NO_STORE_ID, StoreCombobox, type StoreComboboxOption } from '@/components/shared/store-combobox';
import { findDuplicatePic1, PIC_1_TYPE_CODE } from '@/lib/store-pic1';
import type { UserImportReport, ImportSheetInfo } from '@/lib/user-import';
import type { UserDeletionSummary, UserRecordCount } from '@/lib/db/utils/user-deletion';

// ─── Types ────────────────────────────────────────────────────────────────────

interface LookupOption {
  id: number;
  code?: string;
  name?: string;
  label?: string;
  storeNo?: string;
  areaId?: number | null;
}

interface UserRow {
  id: string;
  nik: string;
  name: string;
  isActive: boolean;
  roleId: number;
  roleCode: string;
  roleLabel: string;
  employeeTypeId: number | null;
  employeeTypeCode: string | null;
  employeeTypeLabel: string | null;
  homeStoreId: number | null;
  storeNo: string | null;
  storeName: string | null;
  areaId: number | null;
  areaName: string | null;
  createdAt: string;
}

type EditState = { mode: 'create' } | { mode: 'edit'; user: UserRow };

type SortKey = 'name' | 'nik' | 'role' | 'store' | 'area' | 'status' | 'createdAt';
type SortState = { key: SortKey; dir: 'asc' | 'desc' };

type DeletionPreview = UserDeletionSummary & { isSelf: boolean };

const storeLabel = (s: { storeNo?: string | null; name?: string | null }) =>
  s.storeNo ? `${s.storeNo} · ${s.name ?? ''}` : (s.name ?? '');

const toComboboxStores = (stores: LookupOption[]): StoreComboboxOption[] =>
  stores.map((s) => ({ id: s.id, storeNo: s.storeNo ?? '', name: s.name ?? '' }));

// ─── User form sheet ────────────────────────────────────────────────────────

function UserFormSheet({
  mode, user, allUsers, roles, employeeTypes, stores, areas, onClose, onSaved,
}: {
  mode: 'create' | 'edit';
  user?: UserRow;
  /** Every account — to spot another PIC 1 already in the picked store. */
  allUsers: UserRow[];
  roles: LookupOption[];
  employeeTypes: LookupOption[];
  stores: LookupOption[];
  areas: LookupOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [nik, setNik] = useState(user?.nik ?? '');
  const [name, setName] = useState(user?.name ?? '');
  const [password, setPassword] = useState('');
  const [roleId, setRoleId] = useState<string>(user ? String(user.roleId) : String(roles[0]?.id ?? ''));
  const [employeeTypeId, setEmployeeTypeId] = useState<string>(user?.employeeTypeId ? String(user.employeeTypeId) : '');
  const [homeStoreId, setHomeStoreId] = useState<string>(user?.homeStoreId ? String(user.homeStoreId) : '');
  const [areaId, setAreaId] = useState<string>(user?.areaId ? String(user.areaId) : '');
  const [isActive, setIsActive] = useState(user?.isActive ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // One PIC 1 per store (lib/store-pic1.ts): warn, don't block — a handover
  // briefly needs both, and IT then changes the other one.
  const pic1TypeId = employeeTypes.find((t) => t.code === PIC_1_TYPE_CODE)?.id;
  const otherPic1s =
    isActive && homeStoreId && pic1TypeId != null && employeeTypeId === String(pic1TypeId)
      ? allUsers.filter((u) =>
          u.id !== user?.id && u.isActive && u.homeStoreId === Number(homeStoreId) && u.employeeTypeCode === PIC_1_TYPE_CODE)
      : [];
  const pickedStore = homeStoreId ? stores.find((s) => String(s.id) === homeStoreId) : undefined;

  async function handleSubmit() {
    setError(null);

    if (!name.trim()) { setError('Name is required.'); return; }
    if (mode === 'create' && !nik.trim()) { setError('NIK is required.'); return; }
    if (mode === 'create' && (!password || password.length < 8)) {
      setError('Password must be at least 8 characters.'); return;
    }
    if (!roleId) { setError('Role is required.'); return; }

    setSaving(true);
    try {
      const url = mode === 'create' ? '/api/it/users' : `/api/it/users/${user!.id}`;
      const payload: Record<string, unknown> =
        mode === 'create'
          ? {
              nik: nik.trim(),
              name: name.trim(),
              password,
              roleId: Number(roleId),
              employeeTypeId: employeeTypeId ? Number(employeeTypeId) : null,
              homeStoreId: homeStoreId ? Number(homeStoreId) : null,
              areaId: areaId ? Number(areaId) : null,
            }
          : {
              name: name.trim(),
              roleId: Number(roleId),
              employeeTypeId: employeeTypeId ? Number(employeeTypeId) : null,
              homeStoreId: homeStoreId ? Number(homeStoreId) : null,
              areaId: areaId ? Number(areaId) : null,
              isActive,
              ...(password ? { password } : {}),
            };

      const res = await fetch(url, {
        method: mode === 'create' ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data?.error ?? 'Failed to save user.');

      toast.success(mode === 'create' ? 'User created.' : 'User updated.');
      onSaved();
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <UserCircle2 className="h-4 w-4 text-cyan-600" />
            {mode === 'create' ? 'Add User' : `Edit ${user?.name}`}
          </SheetTitle>
          <SheetDescription>
            {mode === 'create' ? 'Create a new account and assign its role.' : "Update this user's role, store, or status."}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-4">
          {error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
              {error}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="nik">NIK</Label>
            <Input
              id="nik"
              value={nik}
              onChange={(e) => setNik(e.target.value)}
              placeholder="e.g. IT-001"
              disabled={saving || mode === 'edit'}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="name">Name</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} disabled={saving} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password">{mode === 'create' ? 'Password' : 'New password (optional)'}</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === 'create' ? 'Min. 8 characters' : 'Leave blank to keep current password'}
              disabled={saving}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="role">Role</Label>
            <Select value={roleId} onValueChange={setRoleId} disabled={saving}>
              <SelectTrigger id="role" className="w-full">
                <SelectValue placeholder="Select role" />
              </SelectTrigger>
              <SelectContent>
                {roles.map((r) => (
                  <SelectItem key={r.id} value={String(r.id)}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="employeeType">Employee type (optional)</Label>
            <Select value={employeeTypeId || '__none'} onValueChange={(v) => setEmployeeTypeId(v === '__none' ? '' : v)} disabled={saving}>
              <SelectTrigger id="employeeType" className="w-full">
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">None</SelectItem>
                {employeeTypes.map((t) => (
                  <SelectItem key={t.id} value={String(t.id)}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="homeStore">Home store (optional)</Label>
            <StoreCombobox
              id="homeStore"
              stores={toComboboxStores(stores)}
              value={homeStoreId ? Number(homeStoreId) : null}
              onChange={(id) => {
                setHomeStoreId(id == null ? '' : String(id));
                const store = id == null ? undefined : stores.find((s) => s.id === id);
                if (store?.areaId) setAreaId(String(store.areaId));
              }}
              allLabel="None"
              modal
              disabled={saving}
              className="h-10 max-w-none"
            />
          </div>

          {otherPic1s.length > 0 && (
            <div className="flex gap-2.5 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2.5 text-xs text-rose-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
              <div className="space-y-0.5">
                <p className="font-bold text-rose-800">
                  {pickedStore ? storeLabel(pickedStore) : 'This store'} already has a PIC 1
                </p>
                <p>
                  {otherPic1s.map((u) => `${u.name} (${u.nik})`).join(', ')}. A store should have only one PIC 1 —
                  change one of them to PIC 2 or SA.
                </p>
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="area">Area (optional)</Label>
            <Select value={areaId || '__none'} onValueChange={(v) => setAreaId(v === '__none' ? '' : v)} disabled={saving}>
              <SelectTrigger id="area" className="w-full">
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">None</SelectItem>
                {areas.map((a) => (
                  <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {mode === 'edit' && (
            <button
              type="button"
              onClick={() => setIsActive((v) => !v)}
              disabled={saving}
              className={cn(
                'flex w-full items-center justify-between rounded-xl border-2 px-4 py-3 text-sm font-semibold transition-all',
                isActive ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-500',
              )}
            >
              <span>{isActive ? 'Active' : 'Deactivated'}</span>
              <span className="text-xs font-normal opacity-70">Tap to {isActive ? 'deactivate' : 'reactivate'}</span>
            </button>
          )}
        </div>

        <SheetFooter className="flex-row gap-2 border-t border-border">
          <Button type="button" variant="outline" onClick={onClose} disabled={saving} className="flex-1">
            Cancel
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={saving} className="flex-1 gap-1.5 bg-cyan-600 hover:bg-cyan-700">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {mode === 'create' ? 'Create User' : 'Save Changes'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// ─── Excel template / export download ─────────────────────────────────────────

async function downloadFile(url: string, fallbackName: string) {
  const res = await fetch(url);
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j?.error ?? `HTTP ${res.status}`);
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const filename = res.headers.get('content-disposition')?.match(/filename="(.+)"/)?.[1] ?? fallbackName;
  const a = document.createElement('a');
  a.href = objectUrl; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(objectUrl);
  return filename;
}

// ─── Import review sheet ("great verification" before anything is written) ──

function ImportReviewSheet({ file, onClose, onImported }: { file: File; onClose: () => void; onImported: () => void }) {
  const [loading, setLoading] = useState(true);
  const [committing, setCommitting] = useState(false);
  const [headerError, setHeaderError] = useState<string | null>(null);
  const [report, setReport] = useState<UserImportReport | null>(null);
  const [committed, setCommitted] = useState(false);
  // A workbook can hold several roster sheets: `requestedSheet` is the admin's
  // pick (undefined = let the server choose), `activeSheet` what it resolved to.
  const [sheets, setSheets] = useState<ImportSheetInfo[]>([]);
  const [requestedSheet, setRequestedSheet] = useState<string | undefined>(undefined);
  const [activeSheet, setActiveSheet] = useState<string | undefined>(undefined);

  const runImport = useCallback(async (commit: boolean, sheet: string | undefined) => {
    const form = new FormData();
    form.append('file', file);
    if (sheet) form.append('sheet', sheet);
    if (commit) form.append('commit', 'true');

    const res = await fetch('/api/it/users/import', { method: 'POST', body: form });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data?.error ?? 'Import failed.');
    }
    return data as { report: UserImportReport; sheetName: string; sheets: ImportSheetInfo[] };
  }, [file]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setHeaderError(null);
    runImport(false, requestedSheet)
      .then((d) => {
        if (cancelled) return;
        setReport(d.report);
        setSheets(d.sheets);
        setActiveSheet(d.sheetName);
      })
      .catch((err) => { if (!cancelled) setHeaderError(err instanceof Error ? err.message : String(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [runImport, requestedSheet]);

  async function handleConfirm() {
    setCommitting(true);
    try {
      const { report: r } = await runImport(true, activeSheet);
      setReport(r);
      setCommitted(true);
      const extras = [
        r.areasCreated ? `${r.areasCreated} area${r.areasCreated !== 1 ? 's' : ''}` : '',
        r.storesCreated ? `${r.storesCreated} store${r.storesCreated !== 1 ? 's' : ''}` : '',
      ].filter(Boolean);
      toast.success(
        `Imported: ${r.created} created, ${r.updated} updated.`
        + (extras.length ? ` Also created ${extras.join(' and ')}.` : '')
        + (r.failed ? ` ${r.failed} failed to write.` : ''),
      );
      onImported();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Import failed.');
    } finally {
      setCommitting(false);
    }
  }

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4 text-cyan-600" />
            Import review — {file.name}
          </SheetTitle>
          <SheetDescription>
            {committed
              ? 'Import complete.'
              : 'Nothing has been written yet. Review the rows below, then confirm.'}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-3 overflow-y-auto px-4 pb-4">
          {sheets.length > 1 && !committed && (
            <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2">
              <label htmlFor="import-sheet" className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Sheet</label>
              <select
                id="import-sheet"
                value={activeSheet ?? ''}
                disabled={loading || committing}
                onChange={(e) => setRequestedSheet(e.target.value)}
                className="h-8 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700 focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-100"
              >
                {sheets.map((sh) => (
                  <option key={sh.name} value={sh.name}>{sh.name} — {sh.rowCount} row{sh.rowCount !== 1 ? 's' : ''}</option>
                ))}
              </select>
            </div>
          )}
          {loading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-cyan-500" /></div>
          ) : headerError ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {headerError}
            </div>
          ) : report ? (
            <>
              <div className="grid grid-cols-5 gap-2">
                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-center">
                  <p className="text-lg font-bold text-slate-900">{report.totalRows}</p>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Rows</p>
                </div>
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-center">
                  <p className="text-lg font-bold text-emerald-700">{committed ? report.created : report.toCreate}</p>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-600">{committed ? 'Created' : 'To create'}</p>
                </div>
                <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-center">
                  <p className="text-lg font-bold text-sky-700">{committed ? report.updated : report.toUpdate}</p>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-sky-600">{committed ? 'Updated' : 'To update'}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-center">
                  <p className="text-lg font-bold text-slate-600">{report.unchanged}</p>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Unchanged</p>
                </div>
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-center">
                  <p className="text-lg font-bold text-rose-700">{committed ? report.failed : report.invalid}</p>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-rose-600">{committed ? 'Failed' : 'Invalid'}</p>
                </div>
              </div>

              {(report.newAreas.length > 0 || report.newStores.length > 0) && (
                <div className="space-y-2 rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-3 text-xs">
                  <p className="font-bold text-emerald-800">
                    {committed ? 'Also created' : 'Will also create'}{' '}
                    {committed ? report.areasCreated : report.newAreas.length} area{(committed ? report.areasCreated : report.newAreas.length) !== 1 ? 's' : ''} and{' '}
                    {committed ? report.storesCreated : report.newStores.length} store{(committed ? report.storesCreated : report.newStores.length) !== 1 ? 's' : ''}
                  </p>
                  {report.newAreas.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {report.newAreas.map((a) => (
                        <span key={a} className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">{a}</span>
                      ))}
                    </div>
                  )}
                  {report.newStores.length > 0 && (
                    <ul className="max-h-32 space-y-0.5 overflow-y-auto text-slate-600">
                      {report.newStores.map((st) => (
                        <li key={st.storeNo}>
                          <span className="font-mono font-semibold text-slate-700">{st.storeNo}</span> · {st.name}
                          <span className="text-slate-400"> · {st.areaName}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {report.newStores.some((st) => st.defaultLocation) && (
                    <p className="text-amber-700">
                      Stores with no coordinates in the file are placed at the default placeholder location — set the real one in Store Management.
                    </p>
                  )}
                </div>
              )}

              {report.pic1Conflicts.length > 0 && (
                <div className="space-y-2 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-xs">
                  <p className="flex items-center gap-1.5 font-bold text-rose-800">
                    <AlertTriangle className="h-3.5 w-3.5 text-rose-600" />
                    {committed ? 'Now' : 'After this import'}, {report.pic1Conflicts.length} store
                    {report.pic1Conflicts.length !== 1 ? 's have' : ' has'} more than one PIC 1
                  </p>
                  <p className="text-rose-700">
                    A store should have only one PIC 1 — change the extra one to PIC 2 or SA, in the file or in Users afterwards.
                  </p>
                  <ul className="max-h-32 space-y-0.5 overflow-y-auto text-rose-700">
                    {report.pic1Conflicts.map((c) => (
                      <li key={c.storeNo}>
                        <span className="font-mono font-semibold text-rose-800">{c.storeNo}</span> · {c.storeName}:{' '}
                        {c.people.map((p) => `${p.name} (${p.row != null ? `row ${p.row}` : 'already in system'})`).join(', ')}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="overflow-hidden rounded-xl border border-slate-200">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-100 bg-slate-50 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                    <tr>
                      <th className="px-3 py-2">Row</th>
                      <th className="px-3 py-2">NIK</th>
                      <th className="px-3 py-2">Name</th>
                      <th className="px-3 py-2">Action</th>
                      <th className="px-3 py-2">Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {report.rows.map((r) => (
                      <tr key={r.row} className={cn(r.status === 'error' && 'bg-rose-50/60')}>
                        <td className="px-3 py-2 tabular-nums text-slate-400">{r.row}</td>
                        <td className="px-3 py-2 font-mono text-slate-600">{r.nik || '—'}</td>
                        <td className="px-3 py-2 font-medium text-slate-700">{r.name || '—'}</td>
                        <td className="px-3 py-2">
                          <span className={cn(
                            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold',
                            r.status === 'error' ? 'bg-rose-100 text-rose-700'
                              : r.action === 'create' ? 'bg-emerald-100 text-emerald-700'
                              : r.action === 'update' ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-500',
                          )}>
                            {r.status === 'error' ? <AlertCircle className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
                            {r.status === 'error' ? 'Error' : r.action === 'create' ? 'Create' : r.action === 'update' ? 'Update' : 'Unchanged'}
                            {committed && r.status === 'ok' && (r.committed ? '' : ' · write failed')}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          {r.errors.map((e, i) => <p key={i} className="text-rose-600">{e}</p>)}
                          {r.warnings.map((w, i) => <p key={i} className="text-amber-600">{w}</p>)}
                          {r.notes.map((n, i) => <p key={i} className="text-emerald-700">{n}</p>)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </div>

        <SheetFooter className="flex-row gap-2 border-t border-border">
          <Button type="button" variant="outline" onClick={onClose} className="flex-1">
            {committed ? 'Close' : 'Cancel'}
          </Button>
          {!committed && (
            <Button
              type="button"
              onClick={handleConfirm}
              disabled={loading || committing || !!headerError || !report || (report.toCreate + report.toUpdate === 0)}
              className="flex-1 gap-1.5 bg-cyan-600 hover:bg-cyan-700"
            >
              {committing && <Loader2 className="h-4 w-4 animate-spin" />}
              Confirm Import{report ? ` (${report.toCreate + report.toUpdate})` : ''}
            </Button>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// ─── Delete user dialog ─────────────────────────────────────────────────────

function RecordList({ items, tone }: { items: UserRecordCount[]; tone: 'amber' | 'slate' }) {
  const shown = items.slice(0, 6);
  const more = items.slice(shown.length).reduce((n, r) => n + r.count, 0);
  return (
    <ul
      className={cn(
        'mt-1.5 space-y-1 rounded-lg border px-3 py-2 text-xs',
        tone === 'amber' ? 'border-amber-200 bg-white/70 text-amber-900' : 'border-slate-200 bg-slate-50 text-slate-600',
      )}
    >
      {shown.map((r) => (
        <li key={r.table} className="flex items-center justify-between gap-3">
          <span className="first-letter:uppercase">{r.label}</span>
          <span className="font-bold tabular-nums">{r.count.toLocaleString('id-ID')}</span>
        </li>
      ))}
      {more > 0 && <li className="text-[11px] opacity-70">+ {more.toLocaleString('id-ID')} more</li>}
    </ul>
  );
}

function DeleteUserDialog({ user, onClose, onChanged }: { user: UserRow; onClose: () => void; onChanged: () => void }) {
  const [preview, setPreview] = useState<DeletionPreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/it/users/${user.id}/deletion`, { cache: 'no-store' })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data?.error ?? 'Failed to check this account.');
        if (!cancelled) setPreview(data as DeletionPreview);
      })
      .catch((err) => { if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err)); });
    return () => { cancelled = true; };
  }, [user.id]);

  async function handleDelete() {
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/it/users/${user.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data?.error ?? 'Failed to delete user.');
      const done = data as UserDeletionSummary;
      const cashKept = done.keptCash.reduce((n, r) => n + r.count, 0);
      toast.success(
        `${user.name} deleted.`
        + (cashKept > 0 ? ` ${cashKept.toLocaleString('id-ID')} cash record${cashKept !== 1 ? 's' : ''} kept as history.` : ''),
      );
      onChanged();
      onClose();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to delete user.');
    } finally {
      setBusy(false);
    }
  }

  let body: ReactNode;
  if (loadError) {
    body = <p className="text-rose-600">{loadError}</p>;
  } else if (!preview) {
    body = (
      <p className="flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Checking this account&apos;s records…
      </p>
    );
  } else if (preview.isSelf) {
    body = <p>You are signed in with this account, so it can&apos;t be deleted.</p>;
  } else {
    const keptOtherTotal = preview.keptOther.reduce((n, r) => n + r.count, 0);
    body = (
      <div className="space-y-3">
        <p>
          NIK {user.nik} is removed: the account can no longer sign in, disappears from every list, and the NIK can
          be used for a new account. This can&apos;t be undone.
        </p>
        {preview.removed.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-slate-600">Removed along with it</p>
            <RecordList items={preview.removed} tone="slate" />
          </div>
        )}
        {preview.keptCash.length > 0 && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5">
            <p className="flex items-center gap-1.5 text-xs font-bold text-amber-800">
              <Banknote className="h-3.5 w-3.5 shrink-0" />
              Cash records stay as history
            </p>
            <p className="mt-0.5 text-xs text-amber-800/90">
              {user.name} is linked to cash records. They are not deleted — they keep showing this name for the audit
              trail.
            </p>
            <RecordList items={preview.keptCash} tone="amber" />
          </div>
        )}
        {keptOtherTotal > 0 && (
          <p className="text-xs text-slate-500">
            Also kept: {keptOtherTotal.toLocaleString('id-ID')} shared record{keptOtherTotal !== 1 ? 's' : ''} other
            people use ({preview.keptOther.slice(0, 3).map((r) => r.label).join(', ')}
            {preview.keptOther.length > 3 ? ', …' : ''}).
          </p>
        )}
      </div>
    );
  }

  const canDelete = preview != null && !preview.isSelf;

  return (
    <AlertDialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <AlertDialogContent className="max-w-md rounded-2xl">
        <AlertDialogHeader className="flex-row items-start gap-3 text-left sm:flex">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-50 text-rose-600">
            <Trash2 className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1 space-y-1.5">
            <AlertDialogTitle className="text-base font-bold text-slate-900">Delete {user.name}?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="max-h-[60vh] overflow-y-auto text-sm text-slate-500">{body}</div>
            </AlertDialogDescription>
          </div>
        </AlertDialogHeader>

        {actionError && (
          <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">{actionError}</p>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          {canDelete && (
            <Button type="button" onClick={handleDelete} disabled={busy} className="gap-1.5 bg-rose-600 text-white hover:bg-rose-700">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Delete user
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ─── List controls ──────────────────────────────────────────────────────────

function SortHeader({
  label, sortKey, sort, onSort,
}: {
  label: string;
  sortKey: SortKey;
  sort: SortState;
  onSort: (key: SortKey) => void;
}) {
  const active = sort.key === sortKey;
  const Icon = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th className="px-4 py-3" aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          'inline-flex items-center gap-1 uppercase tracking-widest transition-colors hover:text-slate-600',
          active && 'text-cyan-700',
        )}
      >
        {label}
        <Icon className={cn('h-3 w-3', !active && 'opacity-40')} />
      </button>
    </th>
  );
}

function FilterSelect({
  label, value, onChange, children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <div className="relative">
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          'h-10 max-w-[200px] appearance-none truncate rounded-xl border pl-3 pr-8 text-sm font-semibold focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-100',
          value === 'all' ? 'border-slate-200 bg-white text-slate-700' : 'border-cyan-300 bg-cyan-50 text-cyan-800',
        )}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
    </div>
  );
}

// First click on a column sorts ascending — except "Added", newest first.
const FIRST_DIR: Record<SortKey, SortState['dir']> = {
  name: 'asc', nik: 'asc', role: 'asc', store: 'asc', area: 'asc', status: 'asc', createdAt: 'desc',
};

const collator = new Intl.Collator('id', { sensitivity: 'base', numeric: true });

function formatAdded(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ItUsersPage() {
  // useSearchParams needs a Suspense boundary for the static prerender.
  return (
    <Suspense
      fallback={
        <div className="flex min-h-full items-center justify-center bg-slate-50">
          <Loader2 className="h-6 w-6 animate-spin text-cyan-500" />
        </div>
      }
    >
      <ItUsersContent />
    </Suspense>
  );
}

function ItUsersContent() {
  const { data: session, status: authStatus } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const isIt = session?.user?.role === 'it';
  const myId = session?.user?.id;

  const [rows, setRows] = useState<UserRow[]>([]);
  const [roles, setRoles] = useState<LookupOption[]>([]);
  const [employeeTypes, setEmployeeTypes] = useState<LookupOption[]>([]);
  const [stores, setStores] = useState<LookupOption[]>([]);
  const [areas, setAreas] = useState<LookupOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');     // employee type code | 'none'
  const [areaFilter, setAreaFilter] = useState('all');     // area id | 'none'
  const [storeFilter, setStoreFilter] = useState<number | null>(null); // null = all · NO_STORE_ID
  const [statusFilter, setStatusFilter] = useState('all'); // 'active' | 'inactive'
  const [pic1Only, setPic1Only] = useState(() => searchParams.get('pic1') === 'duplicates');
  const [sort, setSort] = useState<SortState>({ key: 'name', dir: 'asc' });
  const [editing, setEditing] = useState<EditState | null>(null);
  const [deleting, setDeleting] = useState<UserRow | null>(null);
  const [downloading, setDownloading] = useState<'template' | 'current' | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (authStatus === 'loading') return;
    if (!session) { router.replace('/login'); return; }
    if (!isIt)    router.replace('/');
  }, [authStatus, session, isIt, router]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch('/api/it/users', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data?.error ?? 'Failed to load users.');
      setRows(data.users ?? []);
      setRoles(data.roles ?? []);
      setEmployeeTypes(data.employeeTypes ?? []);
      setStores(data.stores ?? []);
      setAreas(data.areas ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load users.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (isIt) load(); }, [isIt, load]);

  // Stores with 2+ active PIC 1s → those users (lib/store-pic1.ts).
  const pic1Conflicts = useMemo(
    () => findDuplicatePic1(rows, (u) => ({ storeKey: u.homeStoreId, employeeTypeCode: u.employeeTypeCode, isActive: u.isActive })),
    [rows],
  );
  const conflictIds = useMemo(
    () => new Set([...pic1Conflicts.values()].flat().map((u) => u.id)),
    [pic1Conflicts],
  );
  const conflictList = useMemo(
    () => [...pic1Conflicts.values()].sort((a, b) => collator.compare(a[0].storeNo ?? '', b[0].storeNo ?? '')),
    [pic1Conflicts],
  );
  // Once the last conflict is fixed the toggle has nothing left to show.
  const showPic1Only = pic1Only && conflictIds.size > 0;

  const storeOptions = useMemo(
    () => (areaFilter === 'all' || areaFilter === 'none' ? stores : stores.filter((s) => String(s.areaId) === areaFilter)),
    [stores, areaFilter],
  );

  function changeArea(value: string) {
    setAreaFilter(value);
    // Keep the store pick only if it still belongs to the chosen area.
    if (value !== 'all' && value !== 'none' && storeFilter != null && storeFilter !== NO_STORE_ID) {
      const store = stores.find((s) => s.id === storeFilter);
      if (String(store?.areaId) !== value) setStoreFilter(null);
    }
  }

  const filtersActive =
    search.trim() !== '' || roleFilter !== 'all' || typeFilter !== 'all' || areaFilter !== 'all'
    || storeFilter != null || statusFilter !== 'all' || showPic1Only;

  function clearFilters() {
    setSearch('');
    setRoleFilter('all');
    setTypeFilter('all');
    setAreaFilter('all');
    setStoreFilter(null);
    setStatusFilter('all');
    setPic1Only(false);
  }

  function toggleSort(key: SortKey) {
    setSort((prev) =>
      prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: FIRST_DIR[key] },
    );
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((u) => {
      if (roleFilter !== 'all' && u.roleCode !== roleFilter) return false;
      if (typeFilter === 'none' ? u.employeeTypeCode != null : typeFilter !== 'all' && u.employeeTypeCode !== typeFilter) return false;
      if (areaFilter === 'none' ? u.areaId != null : areaFilter !== 'all' && String(u.areaId) !== areaFilter) return false;
      if (storeFilter === NO_STORE_ID ? u.homeStoreId != null : storeFilter != null && u.homeStoreId !== storeFilter) return false;
      if (statusFilter !== 'all' && u.isActive !== (statusFilter === 'active')) return false;
      if (showPic1Only && !conflictIds.has(u.id)) return false;
      if (!q) return true;
      return u.name.toLowerCase().includes(q)
        || u.nik.toLowerCase().includes(q)
        || (u.storeNo ?? '').toLowerCase().includes(q)
        || (u.storeName ?? '').toLowerCase().includes(q);
    });
  }, [rows, search, roleFilter, typeFilter, areaFilter, storeFilter, statusFilter, showPic1Only, conflictIds]);

  const sorted = useMemo(() => {
    const dir = sort.dir === 'asc' ? 1 : -1;
    const roleRank = new Map(roles.map((r, i) => [r.code, i]));
    const typeRank = new Map(employeeTypes.map((t, i) => [t.code, i]));
    // Empty store / area sinks to the bottom in both directions.
    const optional = (a: string | null, b: string | null) =>
      a == null ? (b == null ? 0 : 1) : b == null ? -1 : dir * collator.compare(a, b);

    return [...filtered].sort((a, b) => {
      let c = 0;
      switch (sort.key) {
        case 'name': c = dir * collator.compare(a.name, b.name); break;
        case 'nik': c = dir * collator.compare(a.nik, b.nik); break;
        case 'role':
          c = dir * (
            (roleRank.get(a.roleCode) ?? 99) - (roleRank.get(b.roleCode) ?? 99)
            || (typeRank.get(a.employeeTypeCode ?? '') ?? 99) - (typeRank.get(b.employeeTypeCode ?? '') ?? 99)
          );
          break;
        case 'store': c = optional(a.storeNo, b.storeNo); break;
        case 'area': c = optional(a.areaName, b.areaName); break;
        case 'status': c = dir * (Number(b.isActive) - Number(a.isActive)); break;
        case 'createdAt': c = dir * (Date.parse(a.createdAt) - Date.parse(b.createdAt)); break;
      }
      return c || collator.compare(a.name, b.name);
    });
  }, [filtered, sort, roles, employeeTypes]);

  if (authStatus === 'loading' || !session) return (
    <div className="flex min-h-full items-center justify-center bg-slate-50">
      <Loader2 className="h-6 w-6 animate-spin text-cyan-500" />
    </div>
  );

  if (!isIt) return (
    <div className="flex min-h-full flex-col items-center justify-center gap-4 bg-slate-50 p-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50"><Shield className="h-8 w-8 text-red-500" /></div>
      <p className="text-base font-bold text-slate-800">Access Restricted</p>
      <p className="text-sm text-slate-500">Only IT can manage users.</p>
    </div>
  );

  return (
    <div className="min-h-full bg-slate-50">
      <div className="border-b border-slate-200 bg-white px-6 py-5 lg:px-8">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-cyan-600">IT</p>
            <h1 className="text-xl font-bold text-slate-900">Users</h1>
            <p className="mt-0.5 text-xs text-slate-400">
              {rows.length} account{rows.length !== 1 ? 's' : ''} · {filtered.length} shown
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              disabled={downloading !== null}
              onClick={async () => {
                setDownloading('template');
                try { await downloadFile('/api/it/users/template', 'users_import_template.xlsx'); }
                catch (err) { toast.error(err instanceof Error ? err.message : 'Download failed.'); }
                finally { setDownloading(null); }
              }}
              className="gap-1.5"
            >
              {downloading === 'template' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Template
            </Button>
            <Button
              variant="outline"
              disabled={downloading !== null}
              onClick={async () => {
                setDownloading('current');
                try { await downloadFile('/api/it/users/template?mode=current', 'users_export.xlsx'); }
                catch (err) { toast.error(err instanceof Error ? err.message : 'Download failed.'); }
                finally { setDownloading(null); }
              }}
              className="gap-1.5"
            >
              {downloading === 'current' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
              Export Current
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) setImportFile(file);
              }}
            />
            <Button variant="outline" onClick={() => fileInputRef.current?.click()} className="gap-1.5">
              <Upload className="h-4 w-4" />
              Import Excel
            </Button>
            <Button onClick={() => setEditing({ mode: 'create' })} className="gap-1.5 bg-cyan-600 hover:bg-cyan-700">
              <Plus className="h-4 w-4" />
              Add User
            </Button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl space-y-4 p-6 lg:p-8">
        {/* One PIC 1 per store */}
        {conflictList.length > 0 && (
          <div className="rounded-2xl border border-rose-300 bg-rose-50 p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-rose-100 text-rose-600">
                  <AlertTriangle className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-bold text-rose-800">
                    {conflictList.length} store{conflictList.length !== 1 ? 's have' : ' has'} more than one PIC 1
                  </p>
                  <p className="mt-0.5 text-xs text-rose-700">
                    Each store should have exactly one PIC 1 — the petty-cash holder. Change the extra one to PIC 2 or SA.
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPic1Only(!showPic1Only)}
                className="border-rose-300 bg-white text-rose-700 hover:bg-rose-100 hover:text-rose-800"
              >
                {showPic1Only ? 'Show all users' : 'Show only these'}
              </Button>
            </div>
            <ul className="mt-3 space-y-1.5 text-xs sm:pl-12">
              {conflictList.map((people) => (
                <li key={people[0].homeStoreId} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-rose-800">
                  <span className="font-mono font-bold">{people[0].storeNo}</span>
                  <span className="text-rose-700">{people[0].storeName}</span>
                  <span className="text-rose-300">—</span>
                  {people.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setEditing({ mode: 'edit', user: p })}
                      title={`Edit ${p.name}`}
                      className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 font-semibold text-rose-700 ring-1 ring-rose-200 transition-colors hover:bg-rose-100"
                    >
                      {p.name}
                      <Pencil className="h-2.5 w-2.5" />
                    </button>
                  ))}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, NIK or store…"
              className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-8 text-sm focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-100"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <FilterSelect label="Role" value={roleFilter} onChange={setRoleFilter}>
            <option value="all">All roles</option>
            {roles.map((r) => (
              <option key={r.id} value={r.code}>{r.label}</option>
            ))}
          </FilterSelect>
          <FilterSelect label="Employee type" value={typeFilter} onChange={setTypeFilter}>
            <option value="all">All types</option>
            {employeeTypes.map((t) => (
              <option key={t.id} value={t.code}>{t.label}</option>
            ))}
            <option value="none">No type</option>
          </FilterSelect>
          <FilterSelect label="Area" value={areaFilter} onChange={changeArea}>
            <option value="all">All areas</option>
            {areas.map((a) => (
              <option key={a.id} value={String(a.id)}>{a.name}</option>
            ))}
            <option value="none">No area</option>
          </FilterSelect>
          <StoreCombobox
            stores={toComboboxStores(storeOptions)}
            value={storeFilter}
            onChange={setStoreFilter}
            allLabel="All stores"
            noneLabel="No store"
            className={cn('h-10 w-[250px]', storeFilter != null && 'border-cyan-300 bg-cyan-50')}
          />
          <FilterSelect label="Status" value={statusFilter} onChange={setStatusFilter}>
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </FilterSelect>
          {filtersActive && (
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex h-10 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
            >
              <FilterX className="h-4 w-4" />
              Clear
            </button>
          )}
        </div>

        {/* List */}
        {loading ? (
          <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-cyan-400" /></div>
        ) : sorted.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-slate-200 bg-white py-16 text-center">
            <UserCircle2 className="h-8 w-8 text-slate-300" />
            <p className="text-sm font-bold text-slate-700">No users found</p>
            {filtersActive && (
              <Button variant="outline" size="sm" onClick={clearFilters} className="gap-1.5">
                <FilterX className="h-3.5 w-3.5" />
                Clear filters
              </Button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full min-w-[960px] text-left text-sm">
              <thead className="border-b border-slate-100 bg-slate-50 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                <tr>
                  <SortHeader label="Name" sortKey="name" sort={sort} onSort={toggleSort} />
                  <SortHeader label="NIK" sortKey="nik" sort={sort} onSort={toggleSort} />
                  <SortHeader label="Role" sortKey="role" sort={sort} onSort={toggleSort} />
                  <SortHeader label="Store" sortKey="store" sort={sort} onSort={toggleSort} />
                  <SortHeader label="Area" sortKey="area" sort={sort} onSort={toggleSort} />
                  <SortHeader label="Status" sortKey="status" sort={sort} onSort={toggleSort} />
                  <SortHeader label="Added" sortKey="createdAt" sort={sort} onSort={toggleSort} />
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sorted.map((u) => {
                  const inConflict = conflictIds.has(u.id);
                  const pic1Count = inConflict && u.homeStoreId != null ? (pic1Conflicts.get(u.homeStoreId)?.length ?? 0) : 0;
                  const isSelf = u.id === myId;
                  return (
                    <tr
                      key={u.id}
                      className={cn(
                        inConflict
                          ? 'bg-rose-50 shadow-[inset_3px_0_0_0_var(--color-rose-500)] hover:bg-rose-100/60'
                          : 'hover:bg-slate-50/70',
                      )}
                    >
                      <td className="px-4 py-3 font-semibold text-slate-800">{u.name}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-500">{u.nik}</td>
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold',
                            inConflict ? 'bg-rose-100 text-rose-700' : 'bg-cyan-50 text-cyan-700',
                          )}
                        >
                          {u.roleLabel}
                          {u.employeeTypeLabel && (
                            <span className={inConflict ? 'text-rose-500' : 'text-cyan-500'}>· {u.employeeTypeLabel}</span>
                          )}
                        </span>
                      </td>
                      <td className="max-w-[240px] px-4 py-3">
                        {u.storeNo ? (
                          <p className="truncate text-slate-500" title={storeLabel({ storeNo: u.storeNo, name: u.storeName })}>
                            <span className="font-mono text-xs font-semibold text-slate-600">{u.storeNo}</span>
                            <span className="ml-1.5">{u.storeName}</span>
                          </p>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                        {inConflict && (
                          <p className="mt-0.5 flex items-center gap-1 text-[11px] font-bold text-rose-600">
                            <AlertTriangle className="h-3 w-3 shrink-0" />
                            {pic1Count} PIC 1 in this store — change one
                          </p>
                        )}
                      </td>
                      <td className="max-w-[180px] truncate px-4 py-3 text-slate-500" title={u.areaName ?? undefined}>
                        {u.areaName ?? <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn(
                          'inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold',
                          u.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500',
                        )}>
                          {u.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-400">{formatAdded(u.createdAt)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => setEditing({ mode: 'edit', user: u })}
                            aria-label={`Edit ${u.name}`}
                            title="Edit"
                            className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-cyan-50 hover:text-cyan-600"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => setDeleting(u)}
                            disabled={isSelf}
                            aria-label={`Delete ${u.name}`}
                            title={isSelf ? "You can't delete your own account" : 'Delete'}
                            className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:pointer-events-none disabled:opacity-30"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && (
        <UserFormSheet
          mode={editing.mode}
          user={editing.mode === 'edit' ? editing.user : undefined}
          allUsers={rows}
          roles={roles}
          employeeTypes={employeeTypes}
          stores={stores}
          areas={areas}
          onClose={() => setEditing(null)}
          onSaved={load}
        />
      )}

      {deleting && (
        <DeleteUserDialog
          user={deleting}
          onClose={() => setDeleting(null)}
          onChanged={load}
        />
      )}

      {importFile && (
        <ImportReviewSheet
          file={importFile}
          onClose={() => setImportFile(null)}
          onImported={load}
        />
      )}
    </div>
  );
}
