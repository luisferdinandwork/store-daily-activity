// app/ops/transfer-order/report/page.tsx
//
// The report used to be one page; it is now one page per process. Old links and
// bookmarks land on Item Return.

import { redirect } from 'next/navigation';

export default function TransferOrderReportIndex() {
  redirect('/ops/transfer-order/report/return');
}
