'use client';
// app/it/users/page.tsx — IT user management (create/edit accounts, assign roles).

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  Loader2, Shield, Search, Plus, Pencil, ChevronDown,
  UserCircle2, X, Download, Upload, FileSpreadsheet, CheckCircle2, AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Sheet, SheetContent, SheetTitle, SheetDescription, SheetHeader, SheetFooter } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { UserImportReport, ImportSheetInfo } from '@/lib/user-import';

// ─── Types ────────────────────────────────────────────────────────────────────

interface LookupOption {
  id: number;
  code?: string;
  name?: string;
  label?: string;
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
  storeName: string | null;
  areaId: number | null;
  areaName: string | null;
  createdAt: string;
}

type EditState = { mode: 'create' } | { mode: 'edit'; user: UserRow };

// ─── User form sheet ────────────────────────────────────────────────────────

function UserFormSheet({
  mode, user, roles, employeeTypes, stores, areas, onClose, onSaved,
}: {
  mode: 'create' | 'edit';
  user?: UserRow;
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
            <Select
              value={homeStoreId || '__none'}
              onValueChange={(v) => {
                setHomeStoreId(v === '__none' ? '' : v);
                if (v !== '__none') {
                  const store = stores.find((s) => String(s.id) === v);
                  if (store?.areaId) setAreaId(String(store.areaId));
                }
              }}
              disabled={saving}
            >
              <SelectTrigger id="homeStore" className="w-full">
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">None</SelectItem>
                {stores.map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ItUsersPage() {
  const { data: session, status: authStatus } = useSession();
  const router = useRouter();
  const isIt = session?.user?.role === 'it';

  const [rows, setRows] = useState<UserRow[]>([]);
  const [roles, setRoles] = useState<LookupOption[]>([]);
  const [employeeTypes, setEmployeeTypes] = useState<LookupOption[]>([]);
  const [stores, setStores] = useState<LookupOption[]>([]);
  const [areas, setAreas] = useState<LookupOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [editing, setEditing] = useState<EditState | null>(null);
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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((u) => {
      if (roleFilter !== 'all' && u.roleCode !== roleFilter) return false;
      if (!q) return true;
      return u.name.toLowerCase().includes(q) || u.nik.toLowerCase().includes(q);
    });
  }, [rows, search, roleFilter]);

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
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or NIK…"
              className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-8 text-sm focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-100"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div className="relative">
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="h-10 appearance-none rounded-xl border border-slate-200 bg-white pl-3 pr-8 text-sm font-semibold text-slate-700 focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-100"
            >
              <option value="all">All roles</option>
              {roles.map((r) => (
                <option key={r.id} value={r.code}>{r.label}</option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          </div>
        </div>

        {/* List */}
        {loading ? (
          <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-cyan-400" /></div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-slate-200 bg-white py-16 text-center">
            <UserCircle2 className="h-8 w-8 text-slate-300" />
            <p className="text-sm font-bold text-slate-700">No users found</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-100 bg-slate-50 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">NIK</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Store / Area</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3 font-semibold text-slate-800">{u.name}</td>
                    <td className="px-4 py-3 text-slate-500">{u.nik}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-cyan-50 px-2.5 py-1 text-[11px] font-bold text-cyan-700">
                        {u.roleLabel}
                        {u.employeeTypeLabel && <span className="text-cyan-500">· {u.employeeTypeLabel}</span>}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      {u.storeName ?? '—'}{u.areaName ? ` · ${u.areaName}` : ''}
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn(
                        'inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold',
                        u.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500',
                      )}>
                        {u.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => setEditing({ mode: 'edit', user: u })}
                        aria-label={`Edit ${u.name}`}
                        className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-cyan-50 hover:text-cyan-600"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && (
        <UserFormSheet
          mode={editing.mode}
          user={editing.mode === 'edit' ? editing.user : undefined}
          roles={roles}
          employeeTypes={employeeTypes}
          stores={stores}
          areas={areas}
          onClose={() => setEditing(null)}
          onSaved={load}
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
