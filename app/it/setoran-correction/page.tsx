'use client';
// app/it/setoran-correction/page.tsx — IT only.
// The page itself is shared with Finance: components/setoran-correction/SetoranCorrectionPage.tsx.

import SetoranCorrectionPage from '@/components/setoran-correction/SetoranCorrectionPage';

export default function ItSetoranCorrectionPage() {
  return <SetoranCorrectionPage panel="it" />;
}
