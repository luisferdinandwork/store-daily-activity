'use client';
// components/employee/BackToPicPanel.tsx
//
// Shown only while a PIC user is viewing the mobile employee app on a
// desktop-sized viewport (see lib/pic-view.ts). Clears the override cookie
// and sends them back to /pic.

import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { EMPLOYEE_VIEW_COOKIE } from '@/lib/pic-view';

export default function BackToPicPanel() {
  const router = useRouter();

  function handleClick() {
    document.cookie = `${EMPLOYEE_VIEW_COOKIE}=; path=/; max-age=0`;
    router.push('/pic');
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="fixed left-1/2 top-3 z-[10000] hidden -translate-x-1/2 items-center gap-1.5 rounded-full bg-foreground px-4 py-2 text-xs font-semibold text-background shadow-lg transition-transform hover:scale-105 md:flex"
    >
      <ArrowLeft className="h-3.5 w-3.5" />
      Back to PIC Panel
    </button>
  );
}
