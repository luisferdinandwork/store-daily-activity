// app/audit/cek-modal/page.tsx — Audit Pemeriksaan Kas · Cek Modal (components/audit/cash-check/CekModalView.tsx).
import { Suspense } from 'react';

import CekModalView from '@/components/audit/cash-check/CekModalView';

export default function AuditCekModalPage() {
  return (
    <Suspense>
      <CekModalView />
    </Suspense>
  );
}
