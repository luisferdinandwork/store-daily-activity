// app/ops/impact-visits/report/[storeId]/page.tsx
//
// Impact Visit · Monthly Report · one store (opened from the store list). Reads the store, year and visit type
// from the URL and hands them to the client view; the API decides whether the store is in the caller's scope.

import { jakartaDateKey } from '@/lib/day-bucket';
import { parseReportType, parseReportYear } from '@/lib/impact-visit/report';
import StoreReportView from './StoreReportView';

export default async function ImpactVisitStoreReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ storeId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ storeId }, sp] = await Promise.all([params, searchParams]);
  const thisYear = Number(jakartaDateKey(new Date()).slice(0, 4));

  return (
    <StoreReportView
      key={storeId}
      storeId={storeId}
      initialYear={parseReportYear(sp.year, thisYear)}
      initialType={parseReportType(sp.type)}
    />
  );
}
