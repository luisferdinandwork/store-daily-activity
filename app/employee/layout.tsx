// app/employee/layout.tsx
import { ReactNode } from 'react';
import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth';
import EmployeeMobileNav from '@/components/employee/EmployeeMobileNav';
import MobileOnlyGuard from '@/components/employee/MobileOnlyGuard';
import FloatingMenu from '@/components/employee/FloatingMenu';

export default async function EmployeeLayout({ children }: { children: ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  return (
    <>
      {/* Shown only on desktop — covers the entire viewport */}
      <MobileOnlyGuard />

      {/* Mobile shell — hidden on md+ so the guard takes over */}
      <div className="flex min-h-dvh flex-col bg-secondary md:hidden">
        <main className="flex-1 overflow-x-hidden pb-16">{children}</main>
        
        {/* Existing Bottom Navigation */}
        <EmployeeMobileNav />
        
        {/* New Floating Menu */}
        <FloatingMenu />
      </div>
    </>
  );
}