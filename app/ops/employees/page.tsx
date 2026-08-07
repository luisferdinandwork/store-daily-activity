'use client';
// app/ops/employees/page.tsx
//
// Compact, filterable directory of every employee in the actor's scope — OPS
// HO sees all areas, OPS Area is limited to their own area (both enforced
// server-side by listManageData(), same data source as /ops/manage). This is
// a dense table view; /ops/manage stays the store-by-store transfer
// workspace. Clicking a row opens the same EmployeeDetailSheet used there
// (transfer / schedule / history) so "manage" behaves identically in both
// places.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus, Search, Shield, UserPlus, Users, X } from 'lucide-react';
import { toast } from 'sonner';

import OpsPageHeader from '@/components/ops/layout/OpsPageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

import { EmployeeDetailSheet } from '@/components/ops/manage/employee-detail-sheet';
import type { ManageEmployee, WorkspaceData } from '@/components/ops/manage/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function hueFromString(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}

function Avatar({ name }: { name: string }) {
  const h = hueFromString(name);
  return (
    <div
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
      style={{
        background: `linear-gradient(135deg, hsl(${h} 65% 55%), hsl(${(h + 45) % 360} 70% 45%))`,
      }}
    >
      {initials(name)}
    </div>
  );
}

const ALL = 'all';

// ─── Add Employee dialog ────────────────────────────────────────────────────────

function AddEmployeeDialog({
  open,
  onOpenChange,
  stores,
  employeeTypes,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stores: WorkspaceData['stores'];
  employeeTypes: WorkspaceData['lookups']['employeeTypes'];
  onCreated: () => Promise<void> | void;
}) {
  const [nik, setNik] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [employeeTypeId, setEmployeeTypeId] = useState('');
  const [homeStoreId, setHomeStoreId] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setNik('');
      setName('');
      setPassword('');
      setEmployeeTypeId('');
      setHomeStoreId('');
    }
  }, [open]);

  const canSubmit = nik.trim() && name.trim() && password.length >= 6 && employeeTypeId && homeStoreId;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSaving(true);
    try {
      const res = await fetch('/api/ops/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nik: nik.trim(),
          name: name.trim(),
          password,
          employeeTypeId: Number(employeeTypeId),
          homeStoreId: Number(homeStoreId),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Gagal membuat karyawan.');

      toast.success(`${name.trim()} berhasil ditambahkan.`);
      onOpenChange(false);
      await onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal membuat karyawan.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-4 w-4 text-violet-600" />
            Tambah Karyawan
          </DialogTitle>
          <DialogDescription>
            Membuat akun karyawan baru di store yang kamu kelola.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-bold text-slate-500">NIK</label>
            <Input value={nik} onChange={(e) => setNik(e.target.value)} placeholder="NIK karyawan" />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-bold text-slate-500">Nama</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nama lengkap" />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-bold text-slate-500">Password awal</label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Minimal 6 karakter"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-bold text-slate-500">Role</label>
            <Select value={employeeTypeId} onValueChange={setEmployeeTypeId}>
              <SelectTrigger className="focus:ring-violet-400">
                <SelectValue placeholder="Pilih role…" />
              </SelectTrigger>
              <SelectContent>
                {employeeTypes.map((t) => (
                  <SelectItem key={t.id} value={String(t.id)}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-bold text-slate-500">Toko</label>
            <Select value={homeStoreId} onValueChange={setHomeStoreId}>
              <SelectTrigger className="focus:ring-violet-400">
                <SelectValue placeholder="Pilih toko…" />
              </SelectTrigger>
              <SelectContent>
                {stores.map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit || saving}
            className="w-full gap-1.5 bg-violet-600 hover:bg-violet-700 text-white sm:w-auto"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Buat karyawan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function OpsEmployeesPage() {
  const { data: session, status: authStatus } = useSession();
  const router = useRouter();

  const user = session?.user as any;
  const role = user?.role as string | undefined;
  const isOps = role === 'ops' || role === 'it';

  const [data, setData] = useState<WorkspaceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedEmployee, setSelectedEmployee] = useState<ManageEmployee | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const [query, setQuery] = useState('');
  const [storeFilter, setStoreFilter] = useState<string>(ALL);
  const [roleFilter, setRoleFilter] = useState<string>(ALL);

  useEffect(() => {
    if (authStatus === 'loading') return;
    if (!session) {
      router.replace('/login');
      return;
    }
    if (!isOps) router.replace('/');
  }, [authStatus, session, isOps, router]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/ops/users/workspace', { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to load employees.');
      setData(json);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load employees.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOps) void load();
  }, [isOps, load]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();

    return data.employees
      .filter((e) => (storeFilter === ALL ? true : String(e.homeStoreId) === storeFilter))
      .filter((e) => (roleFilter === ALL ? true : String(e.employeeTypeId) === roleFilter))
      .filter((e) => (q ? e.name.toLowerCase().includes(q) || e.nik.toLowerCase().includes(q) : true))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [data, storeFilter, roleFilter, query]);

  function clearFilters() {
    setQuery('');
    setStoreFilter(ALL);
    setRoleFilter(ALL);
  }

  const hasActiveFilters = query.trim() !== '' || storeFilter !== ALL || roleFilter !== ALL;

  async function handleTransferComplete() {
    setSelectedEmployee(null);
    await load();
  }

  if (authStatus === 'loading' || !session) {
    return (
      <div className="flex min-h-full items-center justify-center bg-slate-50">
        <Loader2 className="h-6 w-6 animate-spin text-violet-400" />
      </div>
    );
  }

  if (!isOps) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-4 bg-slate-50 p-8 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-rose-50 ring-1 ring-rose-100">
          <Shield className="h-8 w-8 text-rose-500" />
        </div>
        <div>
          <p className="text-base font-bold text-slate-800">Akses Dibatasi</p>
          <p className="mt-1 text-sm text-slate-500">
            Hanya pengguna OPS atau Admin yang dapat melihat daftar karyawan.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-slate-50">
      <OpsPageHeader
        scope="OPS · People"
        title="Employees"
        subtitle={
          data
            ? `${data.employees.length} employee${data.employees.length === 1 ? '' : 's'} ${
                data.actor.isHO ? 'across all areas' : 'in your area'
              }`
            : 'Directory of every employee in your scope.'
        }
        onRefresh={load}
        refreshing={loading}
        contentClassName="w-full"
        actions={
          <Button
            onClick={() => setAddOpen(true)}
            disabled={!data}
            className="h-10 gap-1.5 rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white hover:bg-violet-700"
          >
            <UserPlus className="h-4 w-4" />
            Add Employee
          </Button>
        }
      />

      <div className="mx-auto max-w-[1400px] space-y-4 p-6 lg:p-8">
        {/* ── Filter bar ── */}
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Cari nama atau NIK…"
              className="h-9 pl-9 pr-8 text-sm focus-visible:ring-violet-400 focus-visible:border-violet-400"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-600"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          <Select value={storeFilter} onValueChange={setStoreFilter}>
            <SelectTrigger className="h-9 w-[190px] text-sm focus:ring-violet-400">
              <SelectValue placeholder="Semua toko" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Semua toko</SelectItem>
              {(data?.stores ?? []).map((s) => (
                <SelectItem key={s.id} value={String(s.id)}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <SelectTrigger className="h-9 w-[170px] text-sm focus:ring-violet-400">
              <SelectValue placeholder="Semua role" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Semua role</SelectItem>
              {(data?.lookups.employeeTypes ?? []).map((t) => (
                <SelectItem key={t.id} value={String(t.id)}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="flex h-9 items-center gap-1 rounded-lg px-2.5 text-xs font-semibold text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700"
            >
              <X className="h-3 w-3" />
              Reset
            </button>
          )}

          <div className="ml-auto text-xs font-semibold text-slate-400">
            {loading ? '…' : `${filtered.length} of ${data?.employees.length ?? 0}`}
          </div>
        </div>

        {/* ── Table ── */}
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          {loading ? (
            <div className="flex min-h-[320px] items-center justify-center">
              <div className="flex flex-col items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-50">
                  <Loader2 className="h-6 w-6 animate-spin text-violet-500" />
                </div>
                <p className="text-sm font-medium text-slate-400">Memuat karyawan…</p>
              </div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-20 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
                <Users className="h-5 w-5" />
              </div>
              <p className="text-sm font-bold text-slate-700">Tidak ada karyawan yang cocok</p>
              <p className="max-w-xs text-xs text-slate-400">
                {hasActiveFilters ? 'Coba ubah atau reset filter.' : 'Belum ada karyawan di scope ini.'}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-slate-100 hover:bg-transparent">
                  <TableHead className="pl-5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Employee
                  </TableHead>
                  <TableHead className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Role
                  </TableHead>
                  <TableHead className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Store
                  </TableHead>
                  {data?.actor.isHO && (
                    <TableHead className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      Area
                    </TableHead>
                  )}
                  <TableHead className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Status
                  </TableHead>
                  <TableHead className="pr-5 text-right text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    &nbsp;
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((e) => (
                  <TableRow
                    key={e.id}
                    onClick={() => setSelectedEmployee(e)}
                    className="cursor-pointer border-slate-50 transition-colors hover:bg-violet-50/40"
                  >
                    <TableCell className="pl-5 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={e.name} />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-900">{e.name}</p>
                          <p className="truncate text-[11px] text-slate-400">NIK {e.nik}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="py-2.5">
                      {e.employeeTypeLabel ? (
                        <Badge
                          variant="outline"
                          className="border-slate-200 bg-slate-50 px-1.5 py-0 text-[10px] font-semibold text-slate-600"
                        >
                          {e.employeeTypeLabel}
                        </Badge>
                      ) : (
                        <span className="text-xs text-slate-300">—</span>
                      )}
                    </TableCell>
                    <TableCell className="py-2.5">
                      <span className="text-sm text-slate-700">{e.storeName ?? '—'}</span>
                      {e.isTemporary && (
                        <Badge className="ml-1.5 bg-amber-100 px-1.5 py-0 text-[9px] font-bold text-amber-700 hover:bg-amber-100">
                          Periode
                        </Badge>
                      )}
                    </TableCell>
                    {data?.actor.isHO && (
                      <TableCell className="py-2.5 text-sm text-slate-500">{e.areaName ?? '—'}</TableCell>
                    )}
                    <TableCell className="py-2.5">
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold',
                          e.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500',
                        )}
                      >
                        <span
                          className={cn(
                            'h-1.5 w-1.5 rounded-full',
                            e.isActive ? 'bg-emerald-500' : 'bg-slate-400',
                          )}
                        />
                        {e.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </TableCell>
                    <TableCell className="pr-5 py-2.5 text-right">
                      <span className="text-xs font-semibold text-violet-600">Manage</span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </div>

      {selectedEmployee && data && (
        <EmployeeDetailSheet
          employee={selectedEmployee}
          stores={data.stores}
          employeeTypes={data.lookups.employeeTypes}
          employeeRoleId={data.lookups.employeeRoleId}
          isHO={data.actor.isHO}
          onClose={() => setSelectedEmployee(null)}
          onTransferComplete={handleTransferComplete}
          onEditSaved={async () => {
            await load();
            setSelectedEmployee(null);
          }}
        />
      )}

      {data && (
        <AddEmployeeDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          stores={data.stores}
          employeeTypes={data.lookups.employeeTypes}
          onCreated={load}
        />
      )}
    </div>
  );
}
