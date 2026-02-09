// app/ops/page.tsx
import { auth } from '@/app/auth';
import { redirect } from 'next/navigation';
import { OpsDashboard } from '@/components/ops/ops-dashboard';

export default async function OpsPage() {
  const session = await auth();

  if (!session || session.user.role !== 'ops') {
    redirect('/login');
  }

  return <OpsDashboard userId={session.user.id!} />;
}