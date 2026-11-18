// app/ops/impact-visits/report/page.tsx
//
// Impact Visit · Monthly Report — the store list: every store in scope × the 12 months of a year, each month
// showing its visit's Impact Visit and VM Checklist scores. A store opens its own page (./[storeId]). The year
// and visit type live in the URL (?year=&type=) so the store page's "back" lands on the same view.

import { jakartaDateKey } from '@/lib/day-bucket';
import { parseReportType, parseReportYear } from '@/lib/impact-visit/report';
import ReportStoreList from './ReportStoreList';

export default async function ImpactVisitReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const thisYear = Number(jakartaDateKey(new Date()).slice(0, 4));

  return <ReportStoreList initialYear={parseReportYear(sp.year, thisYear)} initialType={parseReportType(sp.type)} />;
}
