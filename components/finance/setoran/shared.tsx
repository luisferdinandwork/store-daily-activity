'use client';
// components/finance/setoran/shared.tsx
//
// Pieces specific to Finance's Setoran Review (daily) and Setoran Report
// (monthly) pages; the generic sheet kit (day navigator, KPI strip, lightbox,
// Excel download …) lives in components/finance/shared/sheet-kit.tsx and is
// re-exported here so the Setoran pages keep a single import.

import { cn } from '@/lib/utils';
import { SectionTabs } from '@/components/finance/shared/sheet-kit';
import { STATUS_META, type ReviewStatus } from '@/lib/setoran-review';

export * from '@/components/finance/shared/sheet-kit';

const TABS = [
  { href: '/finance/setoran', label: 'Review Harian', exact: true },
  { href: '/finance/setoran/report', label: 'Report Bulanan' },
];

export function SetoranTabs() {
  return <SectionTabs tabs={TABS} label="Setoran sections" />;
}

export function StatusBadge({ status, label }: { status: ReviewStatus; label?: string }) {
  const meta = STATUS_META[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset',
        meta.badge,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', meta.dot)} />
      {label ?? meta.label}
    </span>
  );
}
