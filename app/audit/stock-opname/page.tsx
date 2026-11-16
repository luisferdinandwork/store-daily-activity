// app/audit/stock-opname/page.tsx — Audit Stock Opname of one store-day (components/audit/stock-opname/StockOpnameView.tsx).
import { Suspense } from 'react';

import StockOpnameView from '@/components/audit/stock-opname/StockOpnameView';

export default function AuditStockOpnamePage() {
  return (
    <Suspense>
      <StockOpnameView />
    </Suspense>
  );
}
