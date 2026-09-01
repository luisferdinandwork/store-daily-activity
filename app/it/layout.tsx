'use client';
// app/it/layout.tsx
//
// IT (super-admin) panel layout. Mirrors app/finance/layout.tsx, cyan-accented.

import { ReactNode, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import ItSidebar from '@/components/it/layout/ItSidebar';
import ItNavbar  from '@/components/it/layout/ItNavbar';
import RoleSwitchBanner from '@/components/shared/RoleSwitchBanner';

export default function ItLayout({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const { data: session, status } = useSession();
  const router = useRouter();

  // Panel-wide guard — every /it/* page is IT-only. Individual pages keep their
  // own guard too, but this covers the whole panel in one place.
  const role = (session?.user as { role?: string } | undefined)?.role;
  useEffect(() => {
    if (status === 'loading') return;
    if (!session) { router.replace('/login'); return; }
    if (role !== 'it') router.replace('/');
  }, [status, session, role, router]);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <ItSidebar
        collapsed={collapsed}
        userName={(session?.user?.name) ?? 'IT'}
      />
      <div className="flex flex-1 flex-col overflow-hidden">
        <RoleSwitchBanner />
        <ItNavbar
          collapsed={collapsed}
          onToggle={() => setCollapsed((v) => !v)}
        />
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
