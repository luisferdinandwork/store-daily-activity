// app/audit/cek-bin/[storeId]/[date]/page.tsx — Audit "Hasil Cek Bin" detail: one store's Cek Bin of one day, the whole BC answer as a table.
import { notFound } from 'next/navigation';

import CekBinDetailView from '@/components/audit/cek-bin/CekBinDetailView';
import { isDayKey } from '@/lib/day-bucket';

export default async function AuditCekBinDetailPage({ params }: { params: Promise<{ storeId: string; date: string }> }) {
  const { storeId, date } = await params;
  const id = Number(storeId);
  if (!Number.isInteger(id) || id <= 0 || !isDayKey(date)) notFound();
  return <CekBinDetailView storeId={id} date={date} />;
}
