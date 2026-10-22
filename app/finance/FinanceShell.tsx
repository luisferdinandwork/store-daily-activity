'use client';

import type { ReactNode } from 'react';
import { useSession } from 'next-auth/react';
import FinanceSidebar from '@/components/finance/layout/FinanceSidebar';
import PanelShell from '@/components/shared/PanelShell';
import HeaderProfileButton from '@/components/shared/HeaderProfileButton';
import RoleSwitchBanner from '@/components/shared/RoleSwitchBanner';
import PasswordExpiryBanner from '@/components/shared/PasswordExpiryBanner';
import AccountNotificationBell from '@/components/shared/AccountNotificationBell';

export default function FinanceShell({ children }: { children: ReactNode }) {
  const { data: session } = useSession();
  return (
    <PanelShell
      name="Finance"
      tone="emerald"
      sidebar={(collapsed) => <FinanceSidebar collapsed={collapsed} userName={session?.user?.name ?? 'Finance'} />}
      banners={<><RoleSwitchBanner /><PasswordExpiryBanner /></>}
      right={<><AccountNotificationBell /><HeaderProfileButton /></>}
    >
      {children}
    </PanelShell>
  );
}
