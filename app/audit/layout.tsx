'use client';
// app/audit/layout.tsx
//
// Audit panel layout. Mirrors app/finance/layout.tsx: shared collapsed state
// wires AuditSidebar ↔ AuditNavbar so they stay in sync.

import { ReactNode, useState } from 'react';
import { useSession } from 'next-auth/react';
import AuditSidebar from '@/components/audit/layout/AuditSidebar';
import AuditNavbar  from '@/components/audit/layout/AuditNavbar';
import RoleSwitchBanner from '@/components/shared/RoleSwitchBanner';

export default function AuditLayout({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const { data: session } = useSession();

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <AuditSidebar
        collapsed={collapsed}
        userName={(session?.user?.name) ?? 'Audit'}
      />
      <div className="flex flex-1 flex-col overflow-hidden">
        <RoleSwitchBanner />
        <AuditNavbar
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
