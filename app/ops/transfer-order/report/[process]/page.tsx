// app/ops/transfer-order/report/[process]/page.tsx
//
// One page per process — /ops/transfer-order/report/return | receiving | delivery.
// Anything else is a 404. The view itself is report-view.tsx.

import { notFound } from 'next/navigation';

import { isProcess } from '@/lib/transfer-order-report';
import ReportView from '../report-view';

export default async function TransferOrderReportPage({ params }: { params: Promise<{ process: string }> }) {
  const { process } = await params;
  if (!isProcess(process)) notFound();
  return <ReportView process={process} />;
}
