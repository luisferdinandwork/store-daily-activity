'use client';
// components/finance/uang-modal/shared.tsx
//
// Section tabs shared by Finance's Uang Modal Review (daily) and Report
// (monthly) pages.

import { SectionTabs } from '@/components/finance/shared/sheet-kit';

const TABS = [
  { href: '/finance/uang-modal', label: 'Review Harian', exact: true },
  { href: '/finance/uang-modal/report', label: 'Report Bulanan' },
];

export function UangModalTabs() {
  return <SectionTabs tabs={TABS} label="Uang Modal sections" />;
}
