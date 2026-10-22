// app/ops/OpsShell.tsx (client chrome; the server gate is app/ops/layout.tsx)
//
// Shared panel header/sidebar, plus the Ops-specific notifications and mobile tabs.
//
// On a phone (below `md`) the sidebar becomes a drawer, with a bottom tab bar and,
// on pages not built for phones, a banner that stays open — "Buka di desktop
// untuk pengalaman lebih baik" (lib/ops-mobile.ts). The show/hide is CSS; the
// bell + profile and the tab bar (which polls counts) mount in one place only.

'use client';

import { ReactNode } from 'react';
// Access control lives in the server layout (app/ops/layout.tsx → requirePanel) and proxy.ts;
// this client shell only renders chrome.
import OpsSidebar from '@/components/ops/layout/OpsSidebar';
import { OpsDesktopHint, OpsMobileTabBar } from '@/components/ops/layout/OpsMobileChrome';
import PanelShell from '@/components/shared/PanelShell';
import NotificationBell from '@/components/ops/layout/NotificationBell';
import HeaderProfileButton from '@/components/shared/HeaderProfileButton';
import RoleSwitchBanner from '@/components/shared/RoleSwitchBanner';
import PasswordExpiryBanner from '@/components/shared/PasswordExpiryBanner';
import { MOBILE_QUERY, useMediaQuery } from '@/lib/hooks/useMediaQuery';
import { useSession } from 'next-auth/react';

export default function OpsShell({ children }: { children: ReactNode }) {
  const { data: session } = useSession();
  const isMobile = useMediaQuery(MOBILE_QUERY);

  const headerRight = (
    <div className="flex items-center gap-1.5">
      <NotificationBell />
      <HeaderProfileButton />
    </div>
  );

  return (
    <PanelShell
      name="Ops"
      tone="indigo"
      sidebar={(collapsed) => <OpsSidebar collapsed={collapsed} storeName={(session?.user as { storeName?: string } | undefined)?.storeName} />}
      banners={<><RoleSwitchBanner /><PasswordExpiryBanner /></>}
      right={headerRight}
      afterHeader={<OpsDesktopHint />}
      footer={isMobile && <OpsMobileTabBar />}
    >
      {children}
    </PanelShell>
  );
}
