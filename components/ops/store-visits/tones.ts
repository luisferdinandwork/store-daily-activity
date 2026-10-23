// components/ops/store-visits/tones.ts
//
// The one colour code of the visit Report — every chip, dot, bar and badge on the
// calendar, the queue and the area monitor draws from PlanTone (lib/store-visit/plan.ts):
//
//   done    emerald  visit made / cycle met
//   planned indigo   scheduled, time to spare
//   soon    amber    cycle ends today or within 2 days
//   overdue rose     missed the previous cycle (or a finished week without its visit)
//   idle    slate    no visit rule yet (IT sets it) / nothing to plan
//
// Never hand-pick an emerald/indigo/amber/rose on these pages — add to this map.

import type { PlanTone } from '@/lib/store-visit/plan';

export interface ToneStyle {
  label: string;
  /** Solid dot / bar fill. */
  dot: string;
  /** Left stripe of a row / chip. */
  edge: string;
  /** Calendar chip: soft fill, stripe, text. */
  chip: string;
  /** Pill: soft fill + ring + text. */
  pill: string;
  /** Plain coloured text. */
  text: string;
  /** Soft panel background (section headers, tiles). */
  soft: string;
  /** Count badge on a calendar cell. */
  badge: string;
}

export const TONE: Record<PlanTone, ToneStyle> = {
  done: {
    label: 'Sudah dikunjungi',
    dot: 'bg-emerald-500',
    edge: 'border-l-emerald-500',
    chip: 'border-l-emerald-500 bg-emerald-50 text-emerald-900',
    pill: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    text: 'text-emerald-700',
    soft: 'bg-emerald-50/70',
    badge: 'bg-emerald-600 text-white',
  },
  planned: {
    label: 'Dijadwalkan',
    dot: 'bg-indigo-500',
    edge: 'border-l-indigo-500',
    chip: 'border-l-indigo-500 bg-indigo-50 text-indigo-900',
    pill: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
    text: 'text-indigo-700',
    soft: 'bg-indigo-50/70',
    badge: 'bg-indigo-600 text-white',
  },
  soon: {
    label: 'Segera berakhir',
    dot: 'bg-amber-400',
    edge: 'border-l-amber-400',
    chip: 'border-l-amber-500 bg-amber-50 text-amber-900',
    pill: 'bg-amber-50 text-amber-800 ring-amber-200',
    text: 'text-amber-700',
    soft: 'bg-amber-50/70',
    badge: 'bg-amber-500 text-white',
  },
  overdue: {
    label: 'Terlewat',
    dot: 'bg-rose-500',
    edge: 'border-l-rose-500',
    chip: 'border-l-rose-500 bg-rose-50 text-rose-900',
    pill: 'bg-rose-50 text-rose-700 ring-rose-200',
    text: 'text-rose-700',
    soft: 'bg-rose-50/70',
    badge: 'bg-rose-600 text-white',
  },
  idle: {
    label: 'Belum diatur',
    dot: 'bg-slate-300',
    edge: 'border-l-slate-300',
    chip: 'border-l-slate-300 bg-slate-50 text-slate-700',
    pill: 'bg-slate-100 text-slate-600 ring-slate-200',
    text: 'text-slate-500',
    soft: 'bg-slate-50',
    badge: 'bg-slate-500 text-white',
  },
};

/** Order the legend (and any tone list) is shown in. */
export const TONE_ORDER: PlanTone[] = ['overdue', 'soon', 'planned', 'done', 'idle'];
