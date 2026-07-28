'use client';

// app/ops/impact-visits/page.tsx — OPS Impact Visit list + "start a new visit".
//
// Mirrors the desktop panel look of app/ops/issues/page.tsx: OpsPageHeader,
// slate canvas, store filter, card list. Area scoping is enforced
// server-side by resolveOpsScope() in /api/ops/impact-visits.

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import {
  ClipboardCheck, Store as StoreIcon, MapPin, Clock, Loader2, Plus,
  ChevronDown, Shield, Globe2, User,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import OpsPageHeader from '@/components/ops/layout/OpsPageHeader';

// ─── Types ────────────────────────────────────────────────────────────────────

interface VisitListItem {
  id: string;
  visitDate: string;
  status: 'draft' | 'submitted';
  checklistScore: number;
  checklistMaxScore: number;
  checklistGrade: string | null;
  vmChecklistScore: number;
  vmChecklistMaxScore: number;
  vmChecklistGrade: string | null;
  store: { name: string; storeNo: string };
  areaName: string | null;
  visitorName: string | null;
}

interface StoreOption { id: number; storeNo: string; name: string; }
interface AreaGroupOption { id: number; name: string; stores: StoreOption[]; }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(dateStr: string): string {
  const diff  = Date.now() - new Date(dateStr).getTime();
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);
  if (mins  < 1)  return 'just now';
  if (mins  < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days  < 7)  return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function GradeChip({ grade, score, max }: { grade: string | null; score: number; max: number }) {
  if (!grade) {
    return <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-400">— / {max}</span>;
  }
  const pass = grade === 'A';
  return (
    <span className={cn(
      'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold',
      pass ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700',
    )}>
      {grade} · {score}/{max}
    </span>
  );
}

function StatusPill({ status }: { status: 'draft' | 'submitted' }) {
  const submitted = status === 'submitted';
  return (
    <span className={cn(
      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold',
      submitted ? 'bg-indigo-50 text-indigo-700' : 'bg-amber-50 text-amber-700',
    )}>
      {submitted ? 'Submitted' : 'Draft'}
    </span>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ImpactVisitsPage() {
  const { data: session, status: authStatus } = useSession();
  const router = useRouter();
  const role = (session?.user as any)?.role as string | undefined;
  const employeeType = (session?.user as any)?.employeeType as string | undefined;
  const isIt  = role === 'it';
  const isOps = isIt || employeeType === 'ops_area' || employeeType === 'ops_ho';
  const isHO  = isIt || employeeType === 'ops_ho';

  const [visits,     setVisits]     = useState<VisitListItem[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [storeGroups, setStoreGroups] = useState<AreaGroupOption[]>([]);
  const [storeFilter, setStoreFilter] = useState('all');
  const [newStoreId,  setNewStoreId]  = useState('');
  const [creating,    setCreating]    = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    if (authStatus === 'loading') return;
    if (!session) { router.replace('/login'); return; }
    if (!isOps)   router.replace('/');
  }, [authStatus, session, isOps, router]);

  const load = useCallback(async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    try {
      const url = storeFilter === 'all'
        ? '/api/ops/impact-visits'
        : `/api/ops/impact-visits?storeId=${storeFilter}`;
      const res  = await fetch(url, { cache: 'no-store' });
      const data = await res.json();
      setVisits(data.visits ?? []);
    } catch {
      // silent
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, [storeFilter]);

  useEffect(() => { if (isOps) load(); }, [isOps, load]);

  useEffect(() => {
    if (!isOps) return;
    fetch('/api/ops/stores', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (!d.success) return;
        setStoreGroups(d.data.map((g: any) => ({
          id: g.id,
          name: g.name,
          stores: g.stores.map((s: any) => ({ id: s.id, storeNo: s.storeNo, name: s.name })),
        })));
      })
      .catch(() => {});
  }, [isOps]);

  const allStoreOptions = useMemo(() => storeGroups.flatMap((g) => g.stores), [storeGroups]);

  async function handleStartVisit() {
    if (!newStoreId) return;
    setCreating(true);
    setCreateError(null);
    try {
      const res  = await fetch('/api/ops/impact-visits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId: Number(newStoreId) }),
      });
      const data = await res.json();
      if (!data.success) { setCreateError(data.error ?? 'Failed to start visit.'); return; }
      router.push(`/ops/impact-visits/${data.visit.id}`);
    } catch {
      setCreateError('Network error.');
    } finally {
      setCreating(false);
    }
  }

  if (authStatus === 'loading' || !session) return (
    <div className="flex min-h-full items-center justify-center bg-slate-50"><Loader2 className="h-6 w-6 animate-spin text-indigo-400" /></div>
  );

  if (!isOps) return (
    <div className="flex min-h-full flex-col items-center justify-center gap-4 bg-slate-50 p-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50"><Shield className="h-8 w-8 text-red-500" /></div>
      <p className="text-base font-bold text-slate-800">Access Restricted</p>
      <p className="text-sm text-slate-500">Only OPS users can record Impact Visits.</p>
    </div>
  );

  return (
    <div className="min-h-full bg-slate-50">
      <OpsPageHeader
        scope={isHO ? 'OPS · Head Office' : 'OPS · Area Impact Visit'}
        title="Impact Visit"
        subtitle={
          <span className="inline-flex items-center gap-1.5">
            {isHO ? <Globe2 className="h-3.5 w-3.5" /> : <MapPin className="h-3.5 w-3.5" />}
            {isHO ? 'All areas' : 'Your area'}
            <span>·</span>
            <span>{visits.length} visit{visits.length !== 1 ? 's' : ''}</span>
          </span>
        }
        onRefresh={() => load(true)}
        refreshing={refreshing}
        contentClassName="w-full"
      />

      <div className="mx-auto max-w-5xl space-y-6 p-6 lg:p-8">
        {/* New visit */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="mb-3 text-sm font-bold text-slate-800">Start a new visit</p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[240px] flex-1">
              <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-slate-400">Store</label>
              <div className="relative">
                <StoreIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <select
                  value={newStoreId}
                  onChange={(e) => setNewStoreId(e.target.value)}
                  className="h-11 w-full appearance-none rounded-xl border border-slate-200 bg-white pl-10 pr-10 text-sm font-semibold text-slate-800 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                >
                  <option value="">Select a store…</option>
                  {storeGroups.length > 1
                    ? storeGroups.map((g) => (
                        <optgroup key={g.id} label={g.name}>
                          {g.stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </optgroup>
                      ))
                    : allStoreOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              </div>
            </div>
            <button
              type="button"
              disabled={!newStoreId || creating}
              onClick={handleStartVisit}
              className="flex h-11 items-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-bold text-white transition-all hover:bg-indigo-700 disabled:opacity-50"
            >
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Start Visit
            </button>
          </div>
          {createError && <p className="mt-2 text-xs text-rose-600">{createError}</p>}
        </div>

        {/* Filter */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Filter by store</label>
            <select
              value={storeFilter}
              onChange={(e) => setStoreFilter(e.target.value)}
              className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 focus:border-indigo-400 focus:outline-none"
            >
              <option value="all">All stores</option>
              {allStoreOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        </div>

        {/* List */}
        {loading ? (
          <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-indigo-400" /></div>
        ) : visits.length === 0 ? (
          <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-slate-200 bg-white py-20 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-50"><ClipboardCheck className="h-8 w-8 text-slate-300" /></div>
            <div>
              <p className="text-sm font-bold text-slate-700">No visits yet</p>
              <p className="mt-1 text-xs text-slate-400">Pick a store above to start one.</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {visits.map((visit) => (
              <button
                key={visit.id}
                onClick={() => router.push(`/ops/impact-visits/${visit.id}`)}
                className="group flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition-all hover:border-indigo-200 hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-slate-800">{visit.store.name}</p>
                    <p className="text-[11px] text-slate-400">{visit.store.storeNo}</p>
                  </div>
                  <StatusPill status={visit.status} />
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Checklist</span>
                  <GradeChip grade={visit.checklistGrade} score={visit.checklistScore} max={visit.checklistMaxScore} />
                  <span className="mx-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">VM</span>
                  <GradeChip grade={visit.vmChecklistGrade} score={visit.vmChecklistScore} max={visit.vmChecklistMaxScore} />
                </div>

                <div className="flex items-center gap-3 text-[11px] text-slate-400">
                  {visit.areaName && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{visit.areaName}</span>}
                  {visit.visitorName && <span className="flex items-center gap-1"><User className="h-3 w-3" />{visit.visitorName}</span>}
                  <span className="ml-auto flex items-center gap-1"><Clock className="h-3 w-3" />{relativeTime(visit.visitDate)}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
