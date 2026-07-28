'use client';
// app/it/users/page.tsx — IT user management (create/edit accounts, assign roles).

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  Loader2, Shield, Search, Plus, Pencil, ChevronDown,
  UserCircle2, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Sheet, SheetContent, SheetTitle, SheetDescription, SheetHeader, SheetFooter } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

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
    if (mode === 'create' && (!password || password.length < 6)) {
      setError('Password must be at least 6 characters.'); return;
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
              placeholder={mode === 'create' ? 'Min. 6 characters' : 'Leave blank to keep current password'}
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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ItUsersPage() {
  const { data: session, status: authStatus } = useSession();
  const router = useRouter();
  const role = (session?.user as any)?.role as string | undefined;
  const isIt = role === 'it';

  const [rows, setRows] = useState<UserRow[]>([]);
  const [roles, setRoles] = useState<LookupOption[]>([]);
  const [employeeTypes, setEmployeeTypes] = useState<LookupOption[]>([]);
  const [stores, setStores] = useState<LookupOption[]>([]);
  const [areas, setAreas] = useState<LookupOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [editing, setEditing] = useState<EditState | null>(null);

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
          <Button onClick={() => setEditing({ mode: 'create' })} className="gap-1.5 bg-cyan-600 hover:bg-cyan-700">
            <Plus className="h-4 w-4" />
            Add User
          </Button>
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
    </div>
  );
}
