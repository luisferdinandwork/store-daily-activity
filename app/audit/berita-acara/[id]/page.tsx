// app/audit/berita-acara/[id]/page.tsx — one Berita Acara Pemeriksaan Kas: preview, print, edit header, delete.
import { notFound } from 'next/navigation';

import BeritaAcaraDetailView from '@/components/audit/cash-check/BeritaAcaraDetailView';

export default async function AuditBeritaAcaraDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  return <BeritaAcaraDetailView id={id} />;
}
