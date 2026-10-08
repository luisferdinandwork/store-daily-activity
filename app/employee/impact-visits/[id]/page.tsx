'use client';
// app/employee/impact-visits/[id]/page.tsx
//
// One Impact Visit's result for the store team: the scores, Ops's notes, and
// every point Ops answered "tidak" — Impact Visit checklist and VM checklist
// on two tabs, grouped by section — so the team knows what to fix before the
// next visit. Read-only. Data: GET /api/employee/impact-visits/[id].

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { CheckCircle2, MessageSquareText, Search, XCircle } from 'lucide-react';
import { CalendarTile, taskDayInfo } from '@/components/employee/tasks';
import {
  Chip, EmptyState, Notice, Section, Segmented, SkeletonBlocks,
} from '@/components/employee/ui';
import { FixCountBanner, ScoreTile } from '@/components/employee/impact-visit-ui';
import {
  IMPACT_VISIT_TYPE_LABEL,
  groupBySection,
  type ImpactVisitResultDetail,
  type NegativeItem,
} from '@/lib/impact-visit/results';

type Tab = 'main' | 'vm';

const TAB_NAME: Record<Tab, string> = {
  main: 'Impact Visit',
  vm: 'VM Checklist',
};

// ─── One "tidak" point ───────────────────────────────────────────────────────

function NegativeItemCard({ item }: { item: NegativeItem }) {
  return (
    <div className="rounded-2xl border border-red-100 bg-card p-3.5">
      <div className="flex items-start gap-2.5">
        <XCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="text-[13px] font-semibold leading-snug text-foreground">{item.criteria}</p>
            <span className="flex-shrink-0 rounded-md bg-red-50 px-1.5 py-0.5 text-[10px] font-bold text-red-700">
              {item.points} poin
            </span>
          </div>

          <p className="mt-1.5 flex gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
            <Search className="mt-0.5 h-3 w-3 flex-shrink-0" />
            <span>{item.hint}</span>
          </p>

          {item.note && (
            <div className="mt-2 rounded-xl bg-amber-50 px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-wide text-amber-700">Catatan Ops</p>
              <p className="mt-0.5 whitespace-pre-line text-xs leading-relaxed text-amber-900">{item.note}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function NegativeList({ items, tab }: { items: NegativeItem[]; tab: Tab }) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={CheckCircle2}
        title={`Semua poin ${TAB_NAME[tab]} sudah sesuai`}
        description="Tidak ada poin yang dinilai “Tidak” di visit ini. Pertahankan!"
        className="py-8"
      />
    );
  }

  return (
    <div className="space-y-5">
      {groupBySection(items).map((g) => (
        <Section key={g.section} title={g.section} meta={`${g.items.length} poin`}>
          <div className="space-y-2">
            {g.items.map((item) => <NegativeItemCard key={item.id} item={item} />)}
          </div>
        </Section>
      ))}
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function ImpactVisitResultDetailPage() {
  const params = useParams();
  const id = params.id as string;

  const [visit, setVisit] = useState<ImpactVisitResultDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('main');

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/employee/impact-visits/${id}`, { cache: 'no-store' });
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error ?? 'Gagal memuat hasil visit.');
        const v = json.visit as ImpactVisitResultDetail;
        setVisit(v);
        // Open on the checklist that has something to fix.
        if (v.mainNegatives.length === 0 && v.vmNegatives.length > 0) setTab('vm');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Gagal memuat hasil visit.');
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const info = visit ? taskDayInfo(visit.visitDate) : null;
  const type = visit?.visitType ? IMPACT_VISIT_TYPE_LABEL[visit.visitType] : null;

  return (
    <div className="mx-auto w-full max-w-md">
      <div className="space-y-4 px-4 pb-24 pt-4">
        {loading ? (
          <SkeletonBlocks count={4} className="h-24" />
        ) : error || !visit ? (
          <Notice tone="error">{error ?? 'Visit tidak ditemukan.'}</Notice>
        ) : (
          <>
            {/* Summary */}
            <div className="rounded-2xl border border-border bg-card p-3.5">
              <div className="flex items-center gap-3">
                {info && <CalendarTile info={info} />}
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-medium text-muted-foreground">Impact Visit tanggal</p>
                  <p className="mt-0.5 text-sm font-bold leading-snug text-foreground">{info?.long ?? '—'}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {type && <Chip>{type}</Chip>}
                    {visit.visitedByName && (
                      <span className="truncate text-[11px] text-muted-foreground">oleh {visit.visitedByName}</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <ScoreTile label="Impact Visit" result={visit.main} />
                <ScoreTile label="VM Checklist" result={visit.vm} />
              </div>

              <FixCountBanner count={visit.mainNegatives.length + visit.vmNegatives.length} className="mt-2" />
            </div>

            {visit.notes && (
              <Notice tone="neutral" icon={MessageSquareText} title="Catatan Ops">
                <span className="whitespace-pre-line">{visit.notes}</span>
              </Notice>
            )}

            {/* "Tidak" points, per checklist */}
            <div className="space-y-3">
              <Segmented<Tab>
                value={tab}
                onChange={setTab}
                options={[
                  { value: 'main', label: TAB_NAME.main, count: visit.mainNegatives.length },
                  { value: 'vm',   label: TAB_NAME.vm,   count: visit.vmNegatives.length },
                ]}
              />
              <NegativeList tab={tab} items={tab === 'main' ? visit.mainNegatives : visit.vmNegatives} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
