// app/ops/bin-check/page.tsx — Ops "Progres Cek Bin": every store's monthly bin round (components/bin-check).
import BinProgressOverview from '@/components/bin-check/BinProgressOverview';
import { isYearMonth } from '@/lib/bin-round';

export default async function OpsBinCheckPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const { month } = await searchParams;
  return <BinProgressOverview panel="ops" initialMonth={isYearMonth(month) ? month : undefined} />;
}
