'use client';
// app/ops/settings/page.tsx
//
// Ops account settings — currently just self-service password change. Linked
// from the 90-day password-expiry notification and banner.

import { useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import ChangePasswordCard from '@/components/shared/ChangePasswordCard';

export default function OpsSettingsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const role = (session?.user as { role?: string } | undefined)?.role;

  useEffect(() => {
    if (status === 'loading') return;
    if (!session) { router.replace('/login'); return; }
    if (role !== 'ops' && role !== 'it') router.replace('/');
  }, [status, session, role, router]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-bold tracking-tight text-foreground">Pengaturan Akun</h1>
      <p className="mt-1 text-sm text-muted-foreground">Kelola kata sandi akun Anda.</p>
      <div className="mt-6">
        <ChangePasswordCard />
      </div>
    </div>
  );
}
