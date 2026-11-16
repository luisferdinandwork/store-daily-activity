// app/audit/berita-acara-so/[id]/page.tsx — one Stock Opname: BA SO + Surat Pernyataan previews, print, edit kop, delete.
import { notFound } from 'next/navigation';

import SoDetailView from '@/components/audit/stock-opname/SoDetailView';

export default async function AuditBeritaAcaraSoDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  return <SoDetailView id={id} />;
}
