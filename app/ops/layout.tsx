// app/ops/layout.tsx
//
// Wires OpsSidebar ↔ OpsNavbar via a shared `collapsed` state.
// Children (pages) receive OpsNavbar at the top of the <main> column.

'use client';

import { ReactNode, useState } from 'react';
// NOTE: getServerSession auth check is kept in a parent Server Component if needed.
// For this client layout, auth is handled by middleware / page-level guards.
import OpsSidebar from '@/components/ops/layout/OpsSidebar';
import OpsNavbar  from '@/components/ops/layout/OpsNavbar';
import { useSession } from 'next-auth/react';

export default function OpsLayout({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const { data: session } = useSession();

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <OpsSidebar
        collapsed={collapsed}
        storeName={(session?.user as any)?.storeName}
      />
      <div className="flex flex-1 flex-col overflow-hidden">
        <OpsNavbar
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