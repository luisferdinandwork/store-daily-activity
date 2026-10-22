'use client';

import type { ReactNode } from 'react';
import PicSidebar from './PicSidebar';
import PanelShell from '@/components/shared/PanelShell';
import HeaderProfileButton from '@/components/shared/HeaderProfileButton';
import RoleSwitchBanner from '@/components/shared/RoleSwitchBanner';
import PasswordExpiryBanner from '@/components/shared/PasswordExpiryBanner';

export default function PicShell({ children }: { children: ReactNode }) {
  return (
    <PanelShell
      name="PIC"
      tone="indigo"
      sidebar={(collapsed) => <PicSidebar collapsed={collapsed} />}
      banners={<><RoleSwitchBanner /><PasswordExpiryBanner /></>}
      right={<HeaderProfileButton />}
    >
      {children}
    </PanelShell>
  );
}
