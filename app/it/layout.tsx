'use client';
// app/it/layout.tsx
//
// IT (super-admin) panel layout. Mirrors app/finance/layout.tsx, cyan-accented.

import { ReactNode, useState } from 'react';
import { useSession } from 'next-auth/react';
import ItSidebar from '@/components/it/layout/ItSidebar';
import ItNavbar  from '@/components/it/layout/ItNavbar';
import RoleSwitchBanner from '@/components/shared/RoleSwitchBanner';

export default function ItLayout({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const { data: session } = useSession();

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
