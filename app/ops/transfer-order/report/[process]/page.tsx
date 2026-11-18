// app/ops/transfer-order/report/[process]/page.tsx
//
// One page per process — /ops/transfer-order/report/return | receiving | delivery.
// Anything else is a 404. The view itself is report-view.tsx.

import { notFound } from 'next/navigation';

import { isProcess } from '@/lib/transfer-order-report';
import ReportView from '../report-view';

export default async function TransferOrderReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ process: string }>;
  searchParams: Promise<{ period?: string }>;
}) {
  const { process } = await params;
  if (!isProcess(process)) notFound();
  // ?period=daily|weekly|monthly — the Ops Dashboard links straight to "Bulanan".
  const { period } = await searchParams;
  const initialPeriod = period === 'daily' || period === 'weekly' || period === 'monthly' ? period : undefined;
  return <ReportView process={process} initialPeriod={initialPeriod} />;
}
