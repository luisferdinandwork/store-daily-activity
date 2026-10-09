'use client';
// components/ops/impact-visits/VisitHistoryPanel.tsx
//
// "Riwayat Visit" — the store's earlier submitted Impact Visits next to the one
// Ops is filling: per visit the scores, Ops's notes and every point answered
// "Tidak", grouped by section (the same view the store team gets on
// /employee/impact-visits/[id]). Clicking a point jumps to it in the form.
// Data: GET /api/ops/impact-visits/[id]/history (lib/impact-visit/results.ts).

import { useState } from 'react';
import {
  CheckCircle2, ChevronRight, History, MessageSquareText, Navigation, Search, Video, Wrench, X, XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { CheckProgress, CheckStatus } from '@/components/shared/ImpactFollowUp';
import {
  IMPACT_VISIT_TYPE_LABEL,
  groupBySection,
  type ChecklistResultScore,
  type ImpactVisitResultDetail,
  type NegativeItem,
} from '@/lib/impact-visit/results';

export type HistoryTab = 'main' | 'vm';

const TAB_NAME: Record<HistoryTab, string> = {
  main: 'Checklist',
  vm: 'VM Checklist',
};

function visitDay(iso: string, opts: Intl.DateTimeFormatOptions) {
  return new Date(iso).toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', ...opts });
}

function ScoreTile({ label, result }: { label: string; result: ChecklistResultScore }) {
  const pass = result.grade === 'A';
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
      <p className="truncate text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <div className="mt-1 flex items-center gap-1.5">
        <p className="leading-none">
          <span className="text-lg font-black tabular-nums text-slate-900">{result.score}</span>
          <span className="text-xs font-semibold text-slate-400">/{result.maxScore}</span>
        </p>
        {result.grade && (
          <span
            className={cn(
              'ml-auto rounded-md px-1.5 py-0.5 text-[10px] font-bold leading-none',
              pass ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800',
            )}
          >
            Grade {result.grade}
          </span>
        )}
      </div>
    </div>
  );
}

function NegativeItemCard({ item, onJump }: { item: NegativeItem; onJump?: () => void }) {
  return (
    <button
      type="button"
      onClick={onJump}
      disabled={!onJump}
      className="group block w-full rounded-xl border border-rose-100 bg-white p-3 text-left transition-colors enabled:hover:border-rose-200 enabled:hover:bg-rose-50/40"
    >
      <div className="flex items-start gap-2.5">
        <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="text-[13px] font-semibold leading-snug text-slate-800">{item.criteria}</p>
            <span className="shrink-0 rounded-md bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold text-rose-700">
              {item.points} poin
            </span>
          </div>
          <p className="mt-1 flex gap-1.5 text-[11px] leading-relaxed text-slate-400">
            <Search className="mt-0.5 h-3 w-3 shrink-0" />
            <span>{item.hint}</span>
          </p>
          <div className="mt-2"><CheckStatus status={item.followUp?.status} /></div>
          {item.note && (
            <div className="mt-2 rounded-lg bg-amber-50 px-2.5 py-1.5">
              <p className="text-[10px] font-bold uppercase tracking-wide text-amber-700">Catatan Ops</p>
              <p className="mt-0.5 whitespace-pre-line text-xs leading-relaxed text-amber-900">{item.note}</p>
            </div>
          )}
          {onJump && (
            <p className="mt-1.5 flex items-center gap-0.5 text-[11px] font-semibold text-indigo-500 opacity-0 transition-opacity group-hover:opacity-100">
              Lihat di form <ChevronRight className="h-3 w-3" />
            </p>
          )}
        </div>
      </div>
    </button>
  );
}

export default function VisitHistoryPanel({
  visits,
  tab,
  onTabChange,
  onJumpToItem,
  onClose,
  className,
}: {
  /** Earlier submitted visits of the store, latest first (non-empty). */
  visits: ImpactVisitResultDetail[];
  tab: HistoryTab;
  onTabChange: (tab: HistoryTab) => void;
  /** Scrolls the form to a checklist item. */
  onJumpToItem?: (itemId: string, tab: HistoryTab) => void;
  onClose?: () => void;
  className?: string;
}) {
  const [selectedId, setSelectedId] = useState(visits[0]?.id);
  const visit = visits.find((v) => v.id === selectedId) ?? visits[0];
  if (!visit) return null;

  const items = tab === 'main' ? visit.mainNegatives : visit.vmNegatives;
  const fixCount = visit.mainNegatives.length + visit.vmNegatives.length;
  const TypeIcon = visit.visitType === 'virtual' ? Video : Navigation;

  return (
    <div className={cn('flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm', className)}>
      {/* Header */}
      <div className="border-b border-slate-100 px-4 py-3">
        <div className="flex items-start gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
            <History className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-slate-900">Riwayat Visit</p>
            <p className="text-[11px] leading-snug text-slate-400">
              Poin &ldquo;Tidak&rdquo; dari visit sebelumnya — cek lagi di visit ini.
            </p>
          </div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Tutup riwayat"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Visit picker */}
        {visits.length > 1 && (
          <div className="-mx-1 mt-3 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
            {visits.map((v, i) => {
              const on = v.id === visit.id;
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setSelectedId(v.id)}
                  className={cn(
                    'flex shrink-0 flex-col items-start rounded-lg border px-2.5 py-1.5 text-left transition-colors',
                    on ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
                  )}
                >
                  <span className={cn('text-[9px] font-bold uppercase tracking-wide', on ? 'text-indigo-100' : 'text-slate-400')}>
                    {i === 0 ? 'Terakhir' : `${i + 1} visit lalu`}
                  </span>
                  <span className="text-xs font-bold tabular-nums">{visitDay(v.visitDate, { day: '2-digit', month: 'short', year: '2-digit' })}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        <div>
          <p className="text-sm font-bold text-slate-800">
            {visitDay(visit.visitDate, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-400">
            {visit.visitType && (
              <span className="inline-flex items-center gap-1">
                <TypeIcon className="h-3 w-3" />
                {IMPACT_VISIT_TYPE_LABEL[visit.visitType]}
              </span>
            )}
            {visit.visitedByName && <span>oleh {visit.visitedByName}</span>}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <ScoreTile label="Checklist" result={visit.main} />
          <ScoreTile label="VM Checklist" result={visit.vm} />
        </div>
        <CheckProgress summary={visit.followUp} />

        <div
          className={cn(
            'flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold',
            fixCount === 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800',
          )}
        >
          {fixCount === 0 ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <Wrench className="h-4 w-4 shrink-0" />}
          {fixCount === 0 ? 'Semua poin sesuai di visit itu' : `${fixCount} poin dinilai “Tidak”`}
        </div>

        {visit.notes && (
          <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
            <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
              <MessageSquareText className="h-3 w-3" /> Catatan Ops
            </p>
            <p className="mt-0.5 whitespace-pre-line text-xs leading-relaxed text-slate-700">{visit.notes}</p>
          </div>
        )}

        {/* Checklist / VM tabs */}
        <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
          {(['main', 'vm'] as const).map((key) => {
            const count = key === 'main' ? visit.mainNegatives.length : visit.vmNegatives.length;
            const on = tab === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => onTabChange(key)}
                className={cn(
                  'flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-bold transition-colors',
                  on ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700',
                )}
              >
                {TAB_NAME[key]}
                <span
                  className={cn(
                    'rounded-full px-1.5 text-[10px] tabular-nums',
                    count > 0 ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700',
                  )}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {items.length === 0 ? (
          <div className="flex flex-col items-center gap-1.5 rounded-xl border border-dashed border-slate-200 py-8 text-center">
            <CheckCircle2 className="h-6 w-6 text-emerald-500" />
            <p className="text-xs font-semibold text-slate-600">Semua poin {TAB_NAME[tab]} sesuai</p>
            <p className="text-[11px] text-slate-400">Tidak ada poin &ldquo;Tidak&rdquo; di visit itu.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {groupBySection(items).map((g) => (
              <div key={g.section}>
                <div className="mb-1.5 flex items-center justify-between">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{g.section}</p>
                  <span className="text-[10px] text-slate-400">{g.items.length} poin</span>
                </div>
                <div className="space-y-1.5">
                  {g.items.map((item) => (
                    <NegativeItemCard
                      key={item.id}
                      item={item}
                      onJump={onJumpToItem ? () => onJumpToItem(item.id, tab) : undefined}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
