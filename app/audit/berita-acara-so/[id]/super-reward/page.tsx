// app/audit/berita-acara-so/[id]/super-reward/page.tsx — the Super Reward (Lampiran Regular Reward) of one Stock Opname.
import { notFound } from 'next/navigation';

import SuperRewardView from '@/components/audit/stock-opname/SuperRewardView';

export default async function AuditSuperRewardPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  return <SuperRewardView id={id} />;
}
