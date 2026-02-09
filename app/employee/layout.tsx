import { ReactNode } from 'react';
import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth';
import EmployeeMobileNav from '@/components/employee/EmployeeMobileNav';

export default async function EmployeeLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await getServerSession(authOptions);

  // Redirect to login if not authentiwcated
  if (!session) {
    redirect('/login');
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Mobile Navigation - Visible only on mobile */}
      <div className="lg:hidden">
        <EmployeeMobileNav />
      </div>

      {/* Main Content */}
      <main className="pb-16 lg:pb-0">
        {children}
      </main>
    </div>
  );
}