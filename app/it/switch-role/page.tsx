'use client';
// app/it/switch-role/page.tsx — IT self-service role preview.

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  Building2,
  ClipboardCheck,
  Loader2,
  Repeat,
  Shield,
  ShieldCheck,
  Store,
  Undo2,
  UserCircle2,
  Users,
  Wallet,
} from 'lucide-react';
import { toast } from 'sonner';
import { invalidateApi } from '@/lib/client/use-api';
import { cn } from '@/lib/utils';
import { StoreCombobox } from '@/components/shared/store-combobox';

interface RoleOption {
  id: number;
  code: string;
  label: string;
}

interface AreaOption { id: number; name: string }
interface StoreOption { id: number; storeNo: string; name: string; areaId: number }
interface ShiftOption { id: number; code: string; label: string; startTime: string | null; endTime: string | null }

const hhmm = (t: string | null) => (t ? t.slice(0, 5) : '');

const ROLE_META: Record<string, { icon: typeof Users; description: string; accent: string }> = {
  employee: {
    icon: UserCircle2,
    description: 'Store staff — tasks, attendance, schedule, petty cash.',
    accent: 'violet',
  },
  ops: {
    icon: Store,
    description: 'Store operations — schedules, targets, issues, oversight.',
    accent: 'indigo',
  },
  finance: {
    icon: Wallet,
    description: 'Finance team — setoran, uang modal, petty cash refills, store closing.',
    accent: 'emerald',
  },
  audit: {
    icon: ClipboardCheck,
    description: 'Audit team — store visit reviews and compliance checks.',
    accent: 'amber',
  },
};

const DEFAULT_META = { icon: Users, description: 'Preview the app as this role.', accent: 'slate' };

const ACCENT_CLASSES: Record<string, { ring: string; iconBg: string; iconText: string; badge: string }> = {
  violet: { ring: 'border-violet-300 bg-violet-50', iconBg: 'bg-violet-100', iconText: 'text-violet-600', badge: 'bg-violet-600' },
  indigo: { ring: 'border-indigo-300 bg-indigo-50', iconBg: 'bg-indigo-100', iconText: 'text-indigo-600', badge: 'bg-indigo-600' },
  emerald: { ring: 'border-emerald-300 bg-emerald-50', iconBg: 'bg-emerald-100', iconText: 'text-emerald-600', badge: 'bg-emerald-600' },
  amber: { ring: 'border-amber-300 bg-amber-50', iconBg: 'bg-amber-100', iconText: 'text-amber-600', badge: 'bg-amber-600' },
  slate: { ring: 'border-slate-300 bg-slate-50', iconBg: 'bg-slate-100', iconText: 'text-slate-600', badge: 'bg-slate-600' },
};

const EMPLOYEE_TYPE_META: Record<string, { icon: typeof Users; description: string }> = {
  ops_ho: { icon: Building2, description: 'Sees every area and store.' },
  ops_area: { icon: Store, description: 'Limited to one assigned area.' },
  pic_1: { icon: ShieldCheck, description: 'Primary person in charge.' },
  pic_2: { icon: ShieldCheck, description: 'Secondary person in charge.' },
  sa: { icon: UserCircle2, description: 'Sales associate.' },
};

export default function SwitchRolePage() {
  const { data: session, status: authStatus, update } = useSession();
  const router = useRouter();
  const role = (session?.user as any)?.role as string | undefined;
  const switchedFromRoleId = (session?.user as any)?.switchedFromRoleId as number | null | undefined;
  const switchedFromRoleLabel = (session?.user as any)?.switchedFromRoleLabel as string | null | undefined;
  const isIt = role === 'it';

  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [employeeTypes, setEmployeeTypes] = useState<RoleOption[]>([]);
  const [selectedRole, setSelectedRole] = useState('');
  const [selectedEmpType, setSelectedEmpType] = useState('');
  const [areas, setAreas] = useState<AreaOption[]>([]);
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [shifts, setShifts] = useState<ShiftOption[]>([]);
  const [selectedAreaId, setSelectedAreaId] = useState('');
  const [selectedStoreId, setSelectedStoreId] = useState('');
  const [selectedShiftId, setSelectedShiftId] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (authStatus === 'loading') return;
    if (!session) { router.replace('/login'); return; }
    if (!isIt && !switchedFromRoleId) router.replace('/');
  }, [authStatus, session, isIt, switchedFromRoleId, router]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch('/api/it/switch-role', { cache: 'no-store' });
      const data = await res.json();
      if (data.success) {
        setRoles(data.roles ?? []);
        setEmployeeTypes(data.employeeTypes ?? []);
        setAreas(data.areas ?? []);
        setStores(data.stores ?? []);
        setShifts(data.shifts ?? []);
        // Sensible defaults: the test store if it exists, and the first shift.
        const dummy = (data.stores ?? []).find((st: StoreOption) => st.storeNo === 'DUMMY-001');
        if (dummy) setSelectedStoreId(String(dummy.id));
        if (data.shifts?.[0]) setSelectedShiftId(String(data.shifts[0].id));
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (isIt) load(); }, [isIt, load]);

  // Only offer employee types relevant to the picked role — ops_ho/ops_area
  // for Operations, pic_1/pic_2/sa for Employee — instead of showing every
  // type regardless of context.
  const relevantEmpTypes = useMemo(() => {
    if (selectedRole === 'ops') return employeeTypes.filter((t) => t.code.startsWith('ops_'));
    if (selectedRole === 'employee') return employeeTypes.filter((t) => !t.code.startsWith('ops_'));
    return [];
  }, [employeeTypes, selectedRole]);

  function pickRole(code: string) {
    setSelectedRole(code);
    // Every ops / employee preview needs a type — default to the broadest one.
    if (code === 'ops') setSelectedEmpType(employeeTypes.some((t) => t.code === 'ops_ho') ? 'ops_ho' : '');
    else if (code === 'employee') setSelectedEmpType(employeeTypes.some((t) => t.code === 'sa') ? 'sa' : '');
    else setSelectedEmpType('');
  }

  const needsArea = selectedRole === 'ops' && selectedEmpType === 'ops_area';
  const needsStore = selectedRole === 'employee';
  const selectedStore = stores.find((st) => String(st.id) === selectedStoreId);
  const selectedShift = shifts.find((sh) => String(sh.id) === selectedShiftId);
  const selectedArea = areas.find((a) => String(a.id) === selectedAreaId);
  const canSubmit =
    !!selectedRole &&
    (!needsArea || !!selectedAreaId) &&
    (!needsStore || (!!selectedStoreId && !!selectedShiftId));

  async function handleSwitch() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/it/switch-role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'switch',
          roleCode: selectedRole,
          employeeTypeCode: selectedEmpType || undefined,
          areaId: needsArea ? Number(selectedAreaId) : undefined,
          storeId: needsStore ? Number(selectedStoreId) : undefined,
          shiftId: needsStore ? Number(selectedShiftId) : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error ?? 'Failed to switch role.');

      await update();
      invalidateApi();
      toast.success(`Now previewing as ${roles.find((r) => r.code === selectedRole)?.label ?? selectedRole}.`);
      router.push(data.redirectTo ?? '/');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to switch role.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReturn() {
    setSubmitting(true);
    try {
      const res = await fetch('/api/it/switch-role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'return' }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error ?? 'Failed to return to IT.');

      await update();
      invalidateApi();
      toast.success('Back to IT.');
      router.push(data.redirectTo ?? '/it');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to return to IT.');
    } finally {
      setSubmitting(false);
    }
  }

  if (authStatus === 'loading' || !session) return (
    <div className="flex min-h-full items-center justify-center bg-slate-50">
      <Loader2 className="h-6 w-6 animate-spin text-cyan-500" />
    </div>
  );

  if (!isIt && !switchedFromRoleId) return (
    <div className="flex min-h-full flex-col items-center justify-center gap-4 bg-slate-50 p-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50"><Shield className="h-8 w-8 text-red-500" /></div>
      <p className="text-base font-bold text-slate-800">Access Restricted</p>
      <p className="text-sm text-slate-500">Only IT can switch roles.</p>
    </div>
  );

  // Currently previewing another role — offer to return, wherever they are.
  if (switchedFromRoleId) {
    const meta = ROLE_META[role ?? ''] ?? DEFAULT_META;
    const accent = ACCENT_CLASSES[meta.accent];
    const Icon = meta.icon;

    return (
      <div className="flex min-h-full items-center justify-center bg-slate-50 p-6 lg:p-8">
        <div className="w-full max-w-md overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className={cn('flex flex-col items-center gap-3 px-6 pb-6 pt-8 text-center', accent.ring)}>
            <div className={cn('flex h-16 w-16 items-center justify-center rounded-2xl', accent.iconBg)}>
              <Icon className={cn('h-8 w-8', accent.iconText)} />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Currently previewing</p>
              <p className="mt-1 text-lg font-bold text-slate-900 capitalize">{role}</p>
            </div>
          </div>

          <div className="space-y-4 p-6">
            <p className="text-center text-sm text-slate-500">
              Your real role (<span className="font-semibold text-slate-700">{switchedFromRoleLabel ?? 'IT'}</span>) is
              saved — return whenever you&apos;re done checking.
            </p>
            <button
              onClick={handleReturn}
              disabled={submitting}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-cyan-600 text-sm font-bold text-white transition-colors hover:bg-cyan-700 disabled:opacity-60"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />}
              Return to IT
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-slate-50">
      <div className="border-b border-slate-200 bg-white px-6 py-5 lg:px-8">
        <div className="mx-auto max-w-3xl">
          <p className="text-[10px] font-bold uppercase tracking-widest text-cyan-600">IT</p>
          <h1 className="text-xl font-bold text-slate-900">Switch Role</h1>
          <p className="mt-0.5 text-xs text-slate-400">Preview the app as another role. You can switch back any time.</p>
        </div>
      </div>

      <div className="mx-auto max-w-3xl space-y-6 p-6 lg:p-8">
        {loading ? (
          <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-cyan-400" /></div>
        ) : (
          <>
            {/* Step 1 — role cards */}
            <div>
              <p className="mb-2.5 text-xs font-bold uppercase tracking-widest text-slate-400">1. Choose a role</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {roles.map((r) => {
                  const meta = ROLE_META[r.code] ?? DEFAULT_META;
                  const accent = ACCENT_CLASSES[meta.accent];
                  const Icon = meta.icon;
                  const active = selectedRole === r.code;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => pickRole(r.code)}
                      className={cn(
                        'flex items-start gap-3 rounded-2xl border-2 bg-white p-4 text-left shadow-sm transition-all',
                        active ? accent.ring : 'border-slate-200 hover:border-slate-300',
                      )}
                    >
                      <div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', accent.iconBg)}>
                        <Icon className={cn('h-5 w-5', accent.iconText)} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-slate-900">{r.label}</p>
                        <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{meta.description}</p>
                      </div>
                      <div
                        className={cn(
                          'mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
                          active ? cn(accent.badge, 'border-transparent') : 'border-slate-200',
                        )}
                      >
                        {active && <div className="h-2 w-2 rounded-full bg-white" />}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Step 2 — employee type chips, only when relevant */}
            {selectedRole && relevantEmpTypes.length > 0 && (
              <div>
                <p className="mb-2.5 text-xs font-bold uppercase tracking-widest text-slate-400">
                  2. Employee type
                </p>
                <div className="flex flex-wrap gap-2">
                  {relevantEmpTypes.map((t) => {
                    const meta = EMPLOYEE_TYPE_META[t.code] ?? { icon: Users, description: '' };
                    const Icon = meta.icon;
                    const active = selectedEmpType === t.code;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setSelectedEmpType(t.code)}
                        className={cn(
                          'flex items-center gap-2 rounded-xl border-2 px-3.5 py-2.5 text-left transition-colors',
                          active ? 'border-cyan-400 bg-cyan-50' : 'border-slate-200 bg-white hover:border-slate-300',
                        )}
                      >
                        <Icon className={cn('h-4 w-4 shrink-0', active ? 'text-cyan-600' : 'text-slate-400')} />
                        <div>
                          <p className={cn('text-xs font-bold', active ? 'text-cyan-700' : 'text-slate-700')}>{t.label}</p>
                          {meta.description && <p className="text-[10px] text-slate-400">{meta.description}</p>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Step 3 — context the preview needs */}
            {needsArea && (
              <div>
                <p className="mb-2.5 text-xs font-bold uppercase tracking-widest text-slate-400">3. Area</p>
                <select
                  value={selectedAreaId}
                  onChange={(e) => setSelectedAreaId(e.target.value)}
                  className="h-11 w-full rounded-xl border-2 border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none focus:border-cyan-400"
                >
                  <option value="">Pilih area…</option>
                  {areas.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </div>
            )}

            {needsStore && (
              <div className="space-y-4">
                <div>
                  <p className="mb-2.5 text-xs font-bold uppercase tracking-widest text-slate-400">3. Store</p>
                  <StoreCombobox
                    stores={stores}
                    value={selectedStoreId ? Number(selectedStoreId) : null}
                    onChange={(id) => setSelectedStoreId(id == null ? '' : String(id))}
                    className="max-w-none"
                  />
                  <p className="mt-1.5 text-[11px] text-slate-400">
                    You&apos;ll appear on this store&apos;s schedule while previewing — prefer the test store (DUMMY-001).
                  </p>
                </div>

                <div>
                  <p className="mb-2.5 text-xs font-bold uppercase tracking-widest text-slate-400">4. Shift</p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {shifts.map((sh) => {
                      const active = selectedShiftId === String(sh.id);
                      return (
                        <button
                          key={sh.id}
                          type="button"
                          onClick={() => setSelectedShiftId(String(sh.id))}
                          className={cn(
                            'rounded-xl border-2 px-3 py-2.5 text-left transition-colors',
                            active ? 'border-cyan-400 bg-cyan-50' : 'border-slate-200 bg-white hover:border-slate-300',
                          )}
                        >
                          <p className={cn('text-xs font-bold', active ? 'text-cyan-700' : 'text-slate-700')}>{sh.label}</p>
                          {sh.startTime && (
                            <p className="text-[10px] tabular-nums text-slate-400">{hhmm(sh.startTime)}–{hhmm(sh.endTime)}</p>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-1.5 text-[11px] text-slate-400">
                    A schedule on this shift is created for every day from today to month end, and topped up each new month.
                  </p>
                </div>
              </div>
            )}

            {/* Submit */}
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs text-slate-500">
                {selectedRole
                  ? (
                    <>
                      Switching to <span className="font-bold text-slate-800">{roles.find((r) => r.code === selectedRole)?.label}</span>
                      {selectedEmpType && (
                        <> · <span className="font-bold text-slate-800">{employeeTypes.find((t) => t.code === selectedEmpType)?.label}</span></>
                      )}
                      {needsArea && selectedArea && <> · <span className="font-bold text-slate-800">{selectedArea.name}</span></>}
                      {needsStore && selectedStore && <> · <span className="font-bold text-slate-800">{selectedStore.storeNo}</span></>}
                      {needsStore && selectedShift && <> · <span className="font-bold text-slate-800">{selectedShift.label}</span></>}
                    </>
                  )
                  : 'Pick a role above to continue.'}
              </p>
              <button
                onClick={handleSwitch}
                disabled={submitting || !canSubmit}
                className="flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-cyan-600 px-5 text-sm font-bold text-white transition-colors hover:bg-cyan-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Repeat className="h-4 w-4" />}
                Switch role
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
