// app/employee/layout.tsx
import { ReactNode } from 'react';
import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { authOptions } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { EMPLOYEE_VIEW_COOKIE } from '@/lib/pic-view';
import EmployeeMobileNav from '@/components/employee/EmployeeMobileNav';
import MobileOnlyGuard from '@/components/employee/MobileOnlyGuard';
import BackToPicPanel from '@/components/employee/BackToPicPanel';
import FloatingMenu from '@/components/employee/FloatingMenu';
import RoleSwitchBanner from '@/components/shared/RoleSwitchBanner';

export default async function EmployeeLayout({ children }: { children: ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

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
      <div className={cn('flex min-h-dvh flex-col bg-secondary', !forceEmployeeView && 'md:hidden')}>
        <RoleSwitchBanner />
        <main className="flex-1 overflow-x-hidden pb-16">{children}</main>

        {/* Existing Bottom Navigation */}
        <EmployeeMobileNav />

        {/* New Floating Menu */}
        <FloatingMenu />
      </div>
    </>
  );
}