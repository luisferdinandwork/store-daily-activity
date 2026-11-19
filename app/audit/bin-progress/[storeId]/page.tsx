// app/audit/bin-progress/[storeId]/page.tsx — Audit "Progres Cek Bin" of one store: right / wrong / not-checked bins.
import { notFound } from 'next/navigation';

import BinProgressDetail from '@/components/bin-check/BinProgressDetail';
import SoTabs from '@/components/audit/stock-opname/SoTabs';
import { isYearMonth } from '@/lib/bin-round';

export default async function AuditBinProgressStorePage({
  params,
  searchParams,
}: {
  params: Promise<{ storeId: string }>;
  searchParams: Promise<{ month?: string }>;
}) {
  const [{ storeId }, { month }] = await Promise.all([params, searchParams]);
  const id = Number(storeId);
  if (!Number.isInteger(id) || id <= 0) notFound();
  return <BinProgressDetail panel="audit" storeId={id} initialMonth={isYearMonth(month) ? month : undefined} tabs={<SoTabs />} />;
}
