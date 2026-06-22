'use client';
// app/finance/layout.tsx
//
// Finance panel layout.
// Mirrors app/ops/layout.tsx: shared collapsed state wires
// FinanceSidebar ↔ FinanceNavbar so they stay in sync.

import { ReactNode, useState } from 'react';
import { useSession } from 'next-auth/react';
import FinanceSidebar from '@/components/finance/layout/FinanceSidebar';
import FinanceNavbar  from '@/components/finance/layout/FinanceNavbar';

export default function FinanceLayout({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const { data: session } = useSession();

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <FinanceSidebar
        collapsed={collapsed}
        userName={(session?.user?.name) ?? 'Finance'}
      />
      <div className="flex flex-1 flex-col overflow-hidden">
        <FinanceNavbar
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