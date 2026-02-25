// app/ops/layout.tsx
import { ReactNode } from 'react';
import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth';
import OpsSidebar from '@/components/ops/OpsSidebar';

export default async function OpsLayout({ children }: { children: ReactNode }) {
  const session = await getServerSession(authOptions);

  if (!session) redirect('/login');
  if (session.user?.role !== 'ops' && session.user?.role !== 'admin') {
    redirect('/');
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <OpsSidebar storeName={(session.user as any)?.storeName} />
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}