'use client';

import PanelPageHeader from '@/components/shared/PanelPageHeader';
// app/audit/settings/page.tsx
//
// Audit account settings — currently just self-service password change.
// Linked from the 90-day password-expiry notification and banner.

import { useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import ChangePasswordCard from '@/components/shared/ChangePasswordCard';
import ProfilePictureCard from '@/components/shared/ProfilePictureCard';

export default function AuditSettingsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const role = (session?.user as { role?: string } | undefined)?.role;

  useEffect(() => {
    if (status === 'loading') return;
    if (!session) { router.replace('/login'); return; }
    if (role !== 'audit' && role !== 'it') router.replace('/');
  }, [status, session, role, router]);

  return (
    <div className="px-4 py-8 sm:px-6 lg:px-8">
      <PanelPageHeader scope="Audit" title="Profil & Keamanan" subtitle="Kelola foto profil dan kata sandi akun Anda." />
      <div className="grid items-start gap-6 xl:grid-cols-2">
        <ProfilePictureCard />
        <ChangePasswordCard />
      </div>
    </div>
  );
}
