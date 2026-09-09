'use client';
// app/it/settings/page.tsx
//
// IT account settings — profile picture + self-service password change.

import { useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import ChangePasswordCard from '@/components/shared/ChangePasswordCard';
import ProfilePictureCard from '@/components/shared/ProfilePictureCard';

export default function ItSettingsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const role = (session?.user as { role?: string } | undefined)?.role;

  useEffect(() => {
    if (status === 'loading') return;
    if (!session) { router.replace('/login'); return; }
    if (role !== 'it') router.replace('/');
  }, [status, session, role, router]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-bold tracking-tight text-foreground">Profil &amp; Keamanan</h1>
      <p className="mt-1 text-sm text-muted-foreground">Kelola foto profil dan kata sandi akun Anda.</p>
      <div className="mt-6 space-y-6">
        <ProfilePictureCard />
        <ChangePasswordCard />
      </div>
    </div>
  );
}
