// app/employee/layout.tsx
import { ReactNode } from 'react';
import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth';
import EmployeeMobileNav from '@/components/employee/EmployeeMobileNav';
import MobileOnlyGuard from '@/components/employee/MobileOnlyGuard';

export default async function EmployeeLayout({ children }: { children: ReactNode }) {
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect('/login');
  }

  return (
    <>
      {/* Desktop block - shown only on lg+ via CSS */}
      <MobileOnlyGuard />

      {/* Mobile layout */}
      <div className="employee-shell">
        <main className="employee-main">{children}</main>
        <EmployeeMobileNav />
      </div>

      <style>{`
        /* Show the mobile shell only on small screens */
        .employee-shell {
          display: flex;
          flex-direction: column;
          min-height: 100dvh;
          background: #f8f7f5;
        }

        .employee-main {
          flex: 1;
          padding-bottom: 72px; /* room for fixed bottom nav */
          overflow-x: hidden;
        }

        /* On desktop: hide the entire employee UI */
        @media (min-width: 768px) {
          .employee-shell { display: none; }
        }
      `}</style>
    </>
  );
}