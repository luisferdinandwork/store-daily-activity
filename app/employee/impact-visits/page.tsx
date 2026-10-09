'use client';
// app/employee/impact-visits/page.tsx
//
// Impact Visit Result — the store's latest 3 submitted Impact Visits (Ops store
// audits, EMPLOYEE_VISIBLE_VISITS), latest first and highlighted. Each opens to
// the points Ops marked "tidak", so the team can fix them before the next visit.
// Reached from the floating "More" menu; the back/title bar comes from
// EmployeeHeader.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, ClipboardCheck, Sparkles, Wrench } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CalendarTile, taskDayInfo } from '@/components/employee/tasks';
import { Chip, EmptyState, Notice, SectionLabel, SkeletonBlocks } from '@/components/employee/ui';
import { ScoreTile } from '@/components/employee/impact-visit-ui';
import { CheckProgress } from '@/components/shared/ImpactFollowUp';
import {
  EMPLOYEE_VISIBLE_VISITS,
  IMPACT_VISIT_TYPE_LABEL,
  type ImpactVisitResultSummary,
} from '@/lib/impact-visit/results';

function fixCount(v: ImpactVisitResultSummary): number {
  return v.followUp.total - v.followUp.verified;
}

function typeLabel(v: ImpactVisitResultSummary): string | null {
  return v.visitType ? IMPACT_VISIT_TYPE_LABEL[v.visitType] : null;
}

// ─── Latest visit — the highlighted card on top ──────────────────────────────

function LatestVisitCard({ visit }: { visit: ImpactVisitResultSummary }) {
  const info = taskDayInfo(visit.visitDate);
  const type = typeLabel(visit);

  return (
    <Link
      href={`/employee/impact-visits/${visit.id}`}
      className="block rounded-2xl border-2 border-primary/30 bg-card p-3.5 shadow-sm transition active:scale-[0.99]"
    >
      <div className="flex items-center gap-3">
        {info && <CalendarTile info={info} />}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Chip tone="primary" icon={Sparkles}>Terbaru</Chip>
            {type && <Chip>{type}</Chip>}
          </div>
          <p className="mt-1 text-sm font-bold leading-snug text-foreground">{info?.long ?? '—'}</p>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {visit.visitedByName ? `oleh ${visit.visitedByName}` : 'Ops'}
            {info ? ` · ${info.relative}` : ''}
          </p>
        </div>
        <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <ScoreTile label="Impact Visit" result={visit.main} />
        <ScoreTile label="VM Checklist" result={visit.vm} />
      </div>

      <div className="mt-2"><CheckProgress summary={visit.followUp} /></div>
    </Link>
  );
}

// ─── Older visits ────────────────────────────────────────────────────────────

function VisitRow({ visit }: { visit: ImpactVisitResultSummary }) {
  const info = taskDayInfo(visit.visitDate);
  const type = typeLabel(visit);
  const count = fixCount(visit);

  return (
    <Link
      href={`/employee/impact-visits/${visit.id}`}
      className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3 transition active:scale-[0.99]"
    >
      {info && <CalendarTile info={info} size="sm" tone="muted" />}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold text-foreground">{info?.long ?? '—'}</p>
        <p className="truncate text-[11px] text-muted-foreground">
          {[type, visit.visitedByName].filter(Boolean).join(' · ') || 'Ops'}
        </p>
        <p className="mt-1 text-[11px] font-medium tabular-nums text-muted-foreground">
          Impact {visit.main.score}/{visit.main.maxScore} · VM {visit.vm.score}/{visit.vm.maxScore}
        </p>
      </div>
      <span
        className={cn(
          'inline-flex flex-shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[11px] font-bold',
          count > 0 ? 'bg-amber-50 text-amber-800' : 'bg-green-50 text-green-700',
        )}
      >
        {count > 0 ? <><Wrench className="h-3 w-3" />{count}</> : 'Selesai'}
      </span>
      <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
    </Link>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function ImpactVisitResultsPage() {
  const [visits, setVisits] = useState<ImpactVisitResultSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/employee/impact-visits', { cache: 'no-store' });
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error ?? 'Gagal memuat hasil Impact Visit.');
        setVisits(json.visits);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Gagal memuat hasil Impact Visit.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const [latest, ...older] = visits;

  return (
    <div className="mx-auto w-full max-w-md">
      <div className="space-y-4 px-4 pb-24 pt-4">
        {loading ? (
          <SkeletonBlocks count={4} className="h-24" />
        ) : error ? (
          <Notice tone="error">{error}</Notice>
        ) : !latest ? (
          <EmptyState
            icon={ClipboardCheck}
            title="Belum ada hasil Impact Visit"
            description="Hasil kunjungan Ops ke toko akan muncul di sini setelah visit disubmit."
          />
        ) : (
          <>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Hasil {EMPLOYEE_VISIBLE_VISITS} kunjungan Ops terakhir ke toko. Buka visit untuk melihat
              status perbaikan dan pemeriksaan mingguan oleh Ops.
            </p>

            <LatestVisitCard visit={latest} />

            {older.length > 0 && (
              <section>
                <SectionLabel meta={older.length}>Visit sebelumnya</SectionLabel>
                <div className="space-y-2">
                  {older.map((v) => <VisitRow key={v.id} visit={v} />)}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
