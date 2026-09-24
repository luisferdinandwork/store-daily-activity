'use client';
// components/employee/EmployeeAppBar.tsx
//
// The one top bar of the employee app. Every page gets the same purple bar
// with the Transfer Order (truck) shortcut and the notification bell on the
// right — root tabs show the logo + profile avatar on the left/right, every
// drill-in page (incl. each task detail page, via TaskHeader) shows a back
// button + title, and an optional `meta` line under the title (shift, task
// status, autosave state). Rendered by EmployeeHeader (layout) and TaskHeader.

import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import EmployeeLogoMark from './EmployeeLogoMark';
import EmployeeNotificationBell from './EmployeeNotificationBell';
import EmployeeItemTransfersBadge from './EmployeeItemTransfersBadge';
import HeaderProfileButton from '@/components/shared/HeaderProfileButton';

interface EmployeeAppBarProps {
  /** Omit on root tabs — the logo is shown instead of a back button + title. */
  title?: string;
  /** Small line under the title (shift · status · save state). */
  meta?: ReactNode;
  /** Defaults to router.back(). */
  onBack?: () => void;
  /** Root tab: logo + avatar, no back button. */
  root?: boolean;
}

export default function EmployeeAppBar({ title, meta, onBack, root = false }: EmployeeAppBarProps) {
  const router = useRouter();

  return (
    <header
      className="sticky top-0 z-30 shrink-0 bg-primary text-primary-foreground shadow-[0_1px_0_rgba(0,0,0,0.04)]"
      style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
    >
      <div className="mx-auto flex h-14 w-full max-w-md items-center gap-0.5 px-1.5">
        {root ? (
          <EmployeeLogoMark variant="white" className="ml-2.5 w-24 shrink-0" />
        ) : (
          <button
            type="button"
            onClick={() => (onBack ? onBack() : router.back())}
            aria-label="Kembali"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-primary-foreground/90 transition-colors hover:bg-white/10 active:scale-95"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        )}

        <div className="min-w-0 flex-1">
          {!root && title && (
            <>
              <p className="truncate text-[15px] font-bold leading-tight">{title}</p>
              {meta && (
                <div className="mt-0.5 flex min-w-0 items-center gap-1.5 overflow-hidden text-[11px] leading-tight text-primary-foreground/75">
                  {meta}
                </div>
              )}
            </>
          )}
        </div>

        <EmployeeItemTransfersBadge />
        <EmployeeNotificationBell />
        {root && (
          <HeaderProfileButton
            className="ml-0.5 mr-1 h-9 w-9"
            avatarClassName="h-8 w-8 border-white/30"
            fallbackClassName="bg-white/15 text-primary-foreground"
          />
        )}
      </div>
    </header>
  );
}
