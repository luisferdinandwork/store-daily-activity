// app/ops/bin-check/[storeId]/page.tsx — Ops "Progres Cek Bin" of one store: right / wrong / not-checked bins.
import { notFound } from 'next/navigation';

import BinProgressDetail from '@/components/bin-check/BinProgressDetail';
import { isYearMonth } from '@/lib/bin-round';

export default async function OpsBinCheckStorePage({
  params,
  searchParams,
}: {
  params: Promise<{ storeId: string }>;
  searchParams: Promise<{ month?: string }>;
}) {
  const [{ storeId }, { month }] = await Promise.all([params, searchParams]);
  const id = Number(storeId);
  if (!Number.isInteger(id) || id <= 0) notFound();
  return <BinProgressDetail panel="ops" storeId={id} initialMonth={isYearMonth(month) ? month : undefined} />;
}
