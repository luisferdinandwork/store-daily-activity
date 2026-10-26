'use client';
// app/finance/setoran-correction/page.tsx — Finance (and IT viewing the Finance panel).
// Same page as IT's Koreksi Setoran; the correction is recorded as made by Finance.

import SetoranCorrectionPage from '@/components/setoran-correction/SetoranCorrectionPage';

export default function FinanceSetoranCorrectionPage() {
  return <SetoranCorrectionPage panel="finance" />;
}
