'use client';

// app/ops/impact-visits/report/page.tsx — Impact Visit monthly comparison
// report. Store-first: OPS picks a store, then sees a full question-by-
// question, month-by-month (Jan-Dec) Ya/Tidak comparison for that store's
// Virtual or On Location visits, colour-coded for a quick scan. Area-scoped
// exactly like the list page (ops_area sees only their area, ops_ho all).

import { Fragment, useState, useEffect, useCallback, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, Loader2, Shield, Globe2, MapPin, ChevronLeft, ChevronRight,
  Video, Navigation, Check, X, ClipboardList,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import OpsPageHeader from '@/components/ops/layout/OpsPageHeader';
import StorePickerCombobox, {
  type AreaGroupOption,
} from '@/components/ops/impact-visits/StorePickerCombobox';
import {
  IMPACT_CHECKLIST_SECTIONS, IMPACT_CHECKLIST,
  VM_CHECKLIST_SECTIONS, VM_CHECKLIST,
  type ChecklistItem,
} from '@/lib/impact-visit/checklist-config';
import type { ChecklistResponses } from '@/lib/impact-visit/scoring';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

interface ReportCell {
  visitId: string;
  checklist: { pass: boolean; score: number; max: number };
  money: { ok: boolean };
  vm: { pass: boolean; score: number; max: number };
  checklistResponses: ChecklistResponses;
  vmChecklistResponses: ChecklistResponses;
}

interface StoreReportRow {
  storeId: string;
  storeName: string;
  storeNo: string;
  areaName: string | null;
  months: Record<string, { virtual: ReportCell | null; onLocation: ReportCell | null }>;
}

type VisitTypeKey = 'virtual' | 'onLocation';

/** One colour-coded Ya/Tidak/— cell. */
function AnswerCell({ answer }: { answer: 'ya' | 'tidak' | undefined }) {
  if (!answer) {
    return (
      <div className="flex h-8 items-center justify-center bg-slate-50 text-[11px] font-semibold text-slate-300">—</div>
    );
  }
  const isYa = answer === 'ya';
  return (
    <div
      className={cn(
        'flex h-8 items-center justify-center gap-1 text-[11px] font-bold',
        isYa ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700',
      )}
    >
      {isYa ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
    </div>
  );
}

/** Full question-by-question, month-by-month comparison table for one store + visit type + checklist. */
function QuestionCompareTable({
  title,
  items,
  sections,
  monthResponses,
}: {
  title: string;
  items: ChecklistItem[];
  sections: { section: string; total: number }[];
  monthResponses: Record<string, ChecklistResponses | undefined>;
}) {
  const bySection = new Map<string, ChecklistItem[]>();
  for (const item of items) {
    if (!bySection.has(item.section)) bySection.set(item.section, []);
    bySection.get(item.section)!.push(item);
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2.5">
        <ClipboardList className="h-3.5 w-3.5 text-slate-400" />
        <p className="text-xs font-bold uppercase tracking-widest text-slate-500">{title}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[11px]">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 min-w-[280px] border-b border-r border-slate-100 bg-white px-3 py-2 text-left text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Question
              </th>
              {MONTHS.map((m) => (
                <th key={m} className="min-w-[44px] border-b border-slate-100 px-1 py-2 text-center text-[10px] font-bold text-slate-400">{m}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sections.map(({ section }) => (
              <Fragment key={section}>
                <tr className="bg-indigo-50/40">
                  <td colSpan={13} className="sticky left-0 z-10 border-b border-slate-100 bg-indigo-50/40 px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-indigo-700">
                    {section}
                  </td>
                </tr>
                {(bySection.get(section) ?? []).map((item) => (
                  <tr key={item.id} className="group">
                    <td className="sticky left-0 z-10 border-b border-r border-slate-100 bg-white px-3 py-1.5 text-slate-700 group-hover:bg-slate-50">
                      {item.criteria}
                    </td>
                    {MONTHS.map((_, i) => (
                      <td key={i} className="border-b border-slate-100 p-0 text-center">
                        <AnswerCell answer={monthResponses[String(i + 1)]?.[item.id]?.answer} />
                      </td>
                    ))}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function ImpactVisitReportPage() {
  const { data: session, status: authStatus } = useSession();
  const router = useRouter();
  const role = (session?.user as any)?.role as string | undefined;
  const employeeType = (session?.user as any)?.employeeType as string | undefined;
  const isOps = role === 'it' || employeeType === 'ops_area' || employeeType === 'ops_ho';
  const isHO = role === 'it' || employeeType === 'ops_ho';

  const [year, setYear] = useState(new Date().getFullYear());
  const [reportRows, setReportRows] = useState<StoreReportRow[]>([]);
  const [storeGroups, setStoreGroups] = useState<AreaGroupOption[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState('');
  const [visitType, setVisitType] = useState<VisitTypeKey>('onLocation');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (authStatus === 'loading') return;
    if (!session) { router.replace('/login'); return; }
    if (!isOps)   router.replace('/');
  }, [authStatus, session, isOps, router]);

  const load = useCallback(async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    try {
      const res = await fetch(`/api/ops/impact-visits/report?year=${year}`, { cache: 'no-store' });
      const data = await res.json();
      setReportRows(data.stores ?? []);
    } catch {
      // silent
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, [year]);

  useEffect(() => { if (isOps) load(); }, [isOps, load]);

  useEffect(() => {
    if (!isOps) return;
    fetch('/api/ops/stores', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (!d.success) return;
        const groups: AreaGroupOption[] = d.data.map((g: any) => ({
          id: g.id,
          name: g.name,
          stores: g.stores.map((s: any) => ({ id: s.id, storeNo: s.storeNo, name: s.name })),
        }));
        setStoreGroups(groups);
        if (!selectedStoreId) {
          const firstStore = groups.flatMap((g) => g.stores)[0];
          if (firstStore) setSelectedStoreId(String(firstStore.id));
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOps]);

  const allStoreOptions = useMemo(() => storeGroups.flatMap((g) => g.stores), [storeGroups]);
  const selectedStoreOption = allStoreOptions.find((s) => String(s.id) === selectedStoreId) ?? null;
  const selectedStoreArea = storeGroups.find((g) => g.stores.some((s) => String(s.id) === selectedStoreId)) ?? null;
  const selectedReportRow = reportRows.find((s) => s.storeId === selectedStoreId) ?? null;

  const monthResponses = useMemo(() => {
    const empty: Record<string, { checklist: ChecklistResponses | undefined; vm: ChecklistResponses | undefined }> = {};
    for (let m = 1; m <= 12; m++) {
      const cell = selectedReportRow?.months[String(m)]?.[visitType] ?? null;
      empty[String(m)] = { checklist: cell?.checklistResponses, vm: cell?.vmChecklistResponses };
    }
    return empty;
  }, [selectedReportRow, visitType]);

  const checklistMonths = useMemo(
    () => Object.fromEntries(Object.entries(monthResponses).map(([m, v]) => [m, v.checklist])),
    [monthResponses],
  );
  const vmMonths = useMemo(
    () => Object.fromEntries(Object.entries(monthResponses).map(([m, v]) => [m, v.vm])),
    [monthResponses],
  );

  const visitedMonthCount = Object.values(selectedReportRow?.months ?? {}).filter((m) => m[visitType]).length;

  if (authStatus === 'loading' || !session) return (
    <div className="flex min-h-full items-center justify-center bg-slate-50"><Loader2 className="h-6 w-6 animate-spin text-indigo-400" /></div>
  );

  if (!isOps) return (
    <div className="flex min-h-full flex-col items-center justify-center gap-4 bg-slate-50 p-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50"><Shield className="h-8 w-8 text-red-500" /></div>
      <p className="text-base font-bold text-slate-800">Access Restricted</p>
      <p className="text-sm text-slate-500">Only OPS users can view this report.</p>
    </div>
  );

  return (
    <div className="min-h-full bg-slate-50">
      <OpsPageHeader
        scope={isHO ? 'OPS · Head Office' : 'OPS · Area Impact Visit'}
        title="Impact Visit — Monthly Report"
        subtitle={
          <span className="inline-flex items-center gap-1.5">
            {isHO ? <Globe2 className="h-3.5 w-3.5" /> : <MapPin className="h-3.5 w-3.5" />}
            {isHO ? 'All areas' : 'Your area'}
          </span>
        }
        onRefresh={() => load(true)}
        refreshing={refreshing}
        contentClassName="w-full"
        actions={
          <button
            type="button"
            onClick={() => router.push('/ops/impact-visits')}
            className="flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 text-xs font-bold text-slate-600 hover:bg-slate-50"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Visits
          </button>
        }
      />

      <div className="mx-auto max-w-6xl space-y-4 p-4 lg:p-8">
        {/* Store + year picker */}
        <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="min-w-[240px] flex-1">
            <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-slate-400">Store</label>
            <StorePickerCombobox
              storeGroups={storeGroups}
              selectedValue={selectedStoreId}
              triggerLabel={selectedStoreOption?.name ?? ''}
              onSelect={setSelectedStoreId}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-slate-400">Year</label>
            <div className="inline-flex h-11 items-center rounded-xl border border-slate-200 bg-white">
              <button onClick={() => setYear((y) => y - 1)} className="flex h-full w-9 items-center justify-center rounded-l-xl text-slate-500 hover:bg-slate-50">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="whitespace-nowrap px-3 text-sm font-bold text-slate-700">{year}</span>
              <button onClick={() => setYear((y) => y + 1)} className="flex h-full w-9 items-center justify-center rounded-r-xl text-slate-500 hover:bg-slate-50">
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-indigo-400" /></div>
        ) : !selectedStoreOption ? (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-slate-200 bg-white py-20 text-center">
            <p className="text-sm font-bold text-slate-700">Select a store above</p>
            <p className="text-xs text-slate-400">Its monthly question-by-question comparison will appear here.</p>
          </div>
        ) : (
          <>
            {/* Store header + type tabs */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div>
                <p className="text-sm font-bold text-slate-800">{selectedStoreOption.name}</p>
                <p className="text-[11px] text-slate-400">
                  {selectedStoreOption.storeNo}{selectedStoreArea && ` · ${selectedStoreArea.name}`} · {visitedMonthCount}/12 months with a submitted visit in {year}
                </p>
              </div>
              <div className="inline-flex h-10 items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1">
                {([
                  { key: 'onLocation' as const, label: 'On Location', Icon: Navigation },
                  { key: 'virtual' as const, label: 'Virtual', Icon: Video },
                ]).map(({ key, label, Icon }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setVisitType(key)}
                    className={cn(
                      'flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-bold transition-colors',
                      visitType === key ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:bg-slate-100',
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" /> {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Legend */}
            <div className="flex flex-wrap items-center gap-4 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-[11px] font-semibold text-slate-500">
              <span className="flex items-center gap-1.5"><span className="flex h-4 w-4 items-center justify-center rounded bg-emerald-50 text-emerald-700"><Check className="h-3 w-3" /></span> Ya</span>
              <span className="flex items-center gap-1.5"><span className="flex h-4 w-4 items-center justify-center rounded bg-rose-50 text-rose-700"><X className="h-3 w-3" /></span> Tidak</span>
              <span className="flex items-center gap-1.5"><span className="flex h-4 w-4 items-center justify-center rounded bg-slate-50 text-slate-300">—</span> Tidak ada kunjungan</span>
            </div>

            <div className="space-y-4">
              <QuestionCompareTable
                title="Main Checklist"
                items={IMPACT_CHECKLIST}
                sections={IMPACT_CHECKLIST_SECTIONS}
                monthResponses={checklistMonths}
              />
              <QuestionCompareTable
                title="VM Checklist"
                items={VM_CHECKLIST}
                sections={VM_CHECKLIST_SECTIONS}
                monthResponses={vmMonths}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
