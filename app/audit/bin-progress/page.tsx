// app/audit/bin-progress/page.tsx — Audit "Progres Cek Bin": every store's monthly bin round (components/bin-check).
import BinProgressOverview from '@/components/bin-check/BinProgressOverview';
import SoTabs from '@/components/audit/stock-opname/SoTabs';
import { isYearMonth } from '@/lib/bin-round';

export default async function AuditBinProgressPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const { month } = await searchParams;
  return <BinProgressOverview panel="audit" initialMonth={isYearMonth(month) ? month : undefined} tabs={<SoTabs />} />;
}
