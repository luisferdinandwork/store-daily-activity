'use client';

import type { ReactNode } from 'react';
import { useSession } from 'next-auth/react';
import AuditSidebar from '@/components/audit/layout/AuditSidebar';
import PanelShell from '@/components/shared/PanelShell';
import HeaderProfileButton from '@/components/shared/HeaderProfileButton';
import RoleSwitchBanner from '@/components/shared/RoleSwitchBanner';
import PasswordExpiryBanner from '@/components/shared/PasswordExpiryBanner';
import AccountNotificationBell from '@/components/shared/AccountNotificationBell';

export default function AuditShell({ children }: { children: ReactNode }) {
  const { data: session } = useSession();
  return (
    <PanelShell
      name="Audit"
      tone="amber"
      sidebar={(collapsed) => <AuditSidebar collapsed={collapsed} userName={session?.user?.name ?? 'Audit'} />}
      banners={<><RoleSwitchBanner /><PasswordExpiryBanner /></>}
      right={<><AccountNotificationBell /><HeaderProfileButton /></>}
    >
      {children}
    </PanelShell>
  );
}
