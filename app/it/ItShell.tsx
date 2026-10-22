'use client';

import { useEffect, type ReactNode } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import ItSidebar from '@/components/it/layout/ItSidebar';
import PanelShell from '@/components/shared/PanelShell';
import HeaderProfileButton from '@/components/shared/HeaderProfileButton';
import RoleSwitchBanner from '@/components/shared/RoleSwitchBanner';

export default function ItShell({ children }: { children: ReactNode }) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const role = session?.user?.role;
  useEffect(() => {
    if (status === 'loading') return;
    if (!session) { router.replace('/login'); return; }
    if (role !== 'it') router.replace('/');
  }, [status, session, role, router]);

  return (
    <PanelShell
      name="IT"
      tone="cyan"
      sidebar={(collapsed) => <ItSidebar collapsed={collapsed} userName={session?.user?.name ?? 'IT'} />}
      banners={<RoleSwitchBanner />}
      right={<HeaderProfileButton />}
    >
      {children}
    </PanelShell>
  );
}
