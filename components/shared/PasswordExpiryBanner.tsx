'use client';
// components/shared/PasswordExpiryBanner.tsx
//
// Non-dismissible bar shown in every non-IT panel once the signed-in user's
// password is older than the 90-day limit. Links straight to their
// change-password screen. Renders nothing while loading, for exempt roles, or
// when the password is still within policy. See lib/db/utils/password-policy.ts.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { KeyRound } from 'lucide-react';

interface PasswordStatus {
  success: boolean;
  expired: boolean;
  overdueDays: number;
  changePath: string;
}

export default function PasswordExpiryBanner() {
  const pathname = usePathname();
  const [status, setStatus] = useState<PasswordStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/account/password-status', { cache: 'no-store' })
      .then((r) => r.json())
      .then((json) => {
        if (!cancelled && json?.success) setStatus(json);
      })
      .catch(() => {
        // Silent — a failed check just means no banner.
      });
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  if (!status?.expired) return null;

  // PIC users share the `employee` role but run in the /pic shell, where
  // /employee/settings isn't reachable on desktop — point them at /pic/settings.
  const changePath = pathname?.startsWith('/pic') ? '/pic/settings' : status.changePath;

  // Already on the change-password screen — don't nag on top of the form.
  if (pathname === changePath) return null;

  return (
    <div className="flex items-center justify-between gap-3 bg-red-600 px-4 py-2 text-white">
      <div className="flex min-w-0 items-center gap-2">
        <KeyRound className="h-4 w-4 shrink-0" />
        <p className="truncate text-xs font-semibold">
          Kata sandi Anda sudah lebih dari 90 hari. Demi keamanan, segera ganti kata sandi Anda.
        </p>
      </div>
      <Link
        href={changePath}
        className="shrink-0 rounded-lg bg-white/15 px-2.5 py-1 text-xs font-bold transition-colors hover:bg-white/25"
      >
        Ganti sekarang
      </Link>
    </div>
  );
}
