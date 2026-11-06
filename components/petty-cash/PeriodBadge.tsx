// components/petty-cash/PeriodBadge.tsx
//
// Small marks for the petty cash period rules (lib/petty-cash-period.ts) — one look for the Ops Requests /
// Refills pages, the Ops phone view and the Finance pages:
//
//   PeriodBadge  "Periode Desember" — which period a request or refill is counted in, shown when that is not
//                simply the month it was filed in (a request made while the refill was on its way, a Re-request)
//   LateBadge    "Terlambat" — the refill was sent after the 15th of its period

import { CalendarClock, Clock } from 'lucide-react';

import { cn } from '@/lib/utils';
import { periodLabel, periodMonthName, refillDeadline } from '@/lib/petty-cash-period';

export function PeriodBadge({ month, className }: { month: string; className?: string }) {
  return (
    <span
      title={`Dihitung di periode petty cash ${periodLabel(month)}`}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700 ring-1 ring-inset ring-indigo-200',
        className,
      )}
    >
      <CalendarClock className="h-2.5 w-2.5" aria-hidden />
      Periode {periodMonthName(month)}
    </span>
  );
}

export function LateBadge({ month, className }: { month: string; className?: string }) {
  const [, m, d] = refillDeadline(month).split('-');
  return (
    <span
      title={`Refill periode ${periodLabel(month)} dikirim setelah batas tanggal ${Number(d)} (bulan ${Number(m)})`}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-800 ring-1 ring-inset ring-amber-200',
        className,
      )}
    >
      <Clock className="h-2.5 w-2.5" aria-hidden />
      Terlambat
    </span>
  );
}
