'use client';
// components/pic/layout/PicShell.tsx
//
// Wires PicSidebar ↔ PicNavbar via shared `collapsed` state.
// Mirrors components/ops/layout's OpsLayout pattern.

import { ReactNode, useState } from 'react';
import PicSidebar from './PicSidebar';
import PicNavbar from './PicNavbar';
import RoleSwitchBanner from '@/components/shared/RoleSwitchBanner';

export default function PicShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <PicSidebar collapsed={collapsed} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <RoleSwitchBanner />
        <PicNavbar collapsed={collapsed} onToggle={() => setCollapsed((v) => !v)} />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
