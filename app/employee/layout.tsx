// app/employee/layout.tsx
import { ReactNode } from 'react';
import type { Viewport } from 'next';
import { cookies } from 'next/headers';
import { requirePanel } from '@/lib/auth/guards';
import { cn } from '@/lib/utils';
import { EMPLOYEE_VIEW_COOKIE } from '@/lib/pic-view';
import EmployeeMobileNav from '@/components/employee/EmployeeMobileNav';
import MobileOnlyGuard from '@/components/employee/MobileOnlyGuard';
import BackToPicPanel from '@/components/employee/BackToPicPanel';
import FloatingMenu from '@/components/employee/FloatingMenu';
import EmployeeHeader from '@/components/employee/EmployeeHeader';
import RoleSwitchBanner from '@/components/shared/RoleSwitchBanner';
import PasswordExpiryBanner from '@/components/shared/PasswordExpiryBanner';

// Mobile app chrome: purple status bar to match the app bar, and content drawn
// under the iPhone notch / home indicator so env(safe-area-inset-*) is non-zero
// (the header, bottom nav and sheets pad themselves with it).
export const viewport: Viewport = {
  themeColor: '#7A5AF8',
  viewportFit: 'cover',
};

export default async function EmployeeLayout({ children }: { children: ReactNode }) {
  // employee (incl. PIC) or IT only. Previously ANY signed-in role — ops, finance, audit —
  // could open the employee panel.
  const session = await requirePanel('/employee');

  const isPic =
    session.user.employeeType === 'pic_1' || session.user.employeeType === 'pic_2';

  const cookieStore = await cookies();
  const forceEmployeeView = isPic && cookieStore.get(EMPLOYEE_VIEW_COOKIE)?.value === '1';

  return (
    <>
      {/* Shown only on desktop — covers the entire viewport (bounces PIC to /pic instead,
          unless forceEmployeeView is on, see lib/pic-view.ts) */}
      <MobileOnlyGuard isPic={isPic} forceEmployeeView={forceEmployeeView} />

      {forceEmployeeView && <BackToPicPanel />}

      {/* Mobile shell — hidden on md+ so the guard takes over, unless PIC opted
          into forceEmployeeView, in which case it stays visible on desktop too. */}
      <div className={cn('flex min-h-dvh flex-col bg-background', !forceEmployeeView && 'md:hidden')}>
        <RoleSwitchBanner />
        <PasswordExpiryBanner />
        <EmployeeHeader />
        {/* Bottom padding tracks the nav's live height (+ home indicator). */}
        <main className="flex flex-1 flex-col overflow-x-clip" style={{ paddingBottom: 'var(--emp-bottom)' }}>
          {children}
        </main>

        <EmployeeMobileNav />
        <FloatingMenu />
      </div>
    </>
  );
}