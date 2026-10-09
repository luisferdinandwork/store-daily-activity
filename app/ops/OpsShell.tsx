// app/ops/OpsShell.tsx (client chrome; the server gate is app/ops/layout.tsx)
//
// Wires OpsSidebar ↔ OpsNavbar via a shared `collapsed` state.
// Children (pages) receive OpsNavbar at the top of the <main> column.
//
// On a phone (below `md`) the sidebar + navbar give way to OpsMobileChrome: a
// slim top bar, a bottom tab bar (Dashboard · Issues · Petty Cash · Menu) and,
// on pages not built for phones, a banner that stays open — "Buka di desktop
// untuk pengalaman lebih baik" (lib/ops-mobile.ts). The show/hide is CSS; the
// bell + profile and the tab bar (which polls counts) mount in one place only.

'use client';

import { ReactNode, useState } from 'react';
// Access control lives in the server layout (app/ops/layout.tsx → requirePanel) and proxy.ts;
// this client shell only renders chrome.
import OpsSidebar from '@/components/ops/layout/OpsSidebar';
import OpsNavbar  from '@/components/ops/layout/OpsNavbar';
import { OpsDesktopHint, OpsMobileTabBar, OpsMobileTopBar } from '@/components/ops/layout/OpsMobileChrome';
import NotificationBell from '@/components/ops/layout/NotificationBell';
import HeaderProfileButton from '@/components/shared/HeaderProfileButton';
import RoleSwitchBanner from '@/components/shared/RoleSwitchBanner';
import PasswordExpiryBanner from '@/components/shared/PasswordExpiryBanner';
import { MOBILE_QUERY, useMediaQuery } from '@/lib/hooks/useMediaQuery';
import { useSession } from 'next-auth/react';

export default function OpsShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const { data: session } = useSession();
  const isMobile = useMediaQuery(MOBILE_QUERY);

  const headerRight = (
    <div className="flex items-center gap-1.5">
      <NotificationBell />
      <HeaderProfileButton />
    </div>
  );

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <div className="hidden md:flex">
        <OpsSidebar
          collapsed={collapsed}
          storeName={(session?.user as any)?.storeName}
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <RoleSwitchBanner />
        <PasswordExpiryBanner />
        <OpsNavbar
          className="hidden md:flex"
          collapsed={collapsed}
          onToggle={() => setCollapsed((v) => !v)}
          right={isMobile ? null : headerRight}
        />
        <OpsMobileTopBar right={isMobile ? headerRight : null} />
        <OpsDesktopHint />
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
        {isMobile && <OpsMobileTabBar />}
      </div>
    </div>
  );
}
