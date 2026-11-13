// app/audit/cek-petty-cash/page.tsx — Audit Pemeriksaan Kas · Cek Petty Cash (components/audit/cash-check/CekPettyCashView.tsx).
import { Suspense } from 'react';

import CekPettyCashView from '@/components/audit/cash-check/CekPettyCashView';

export default function AuditCekPettyCashPage() {
  return (
    <Suspense>
      <CekPettyCashView />
    </Suspense>
  );
}
