// app/not-found.tsx
//
// Every unknown URL outside the employee app. "/" routes each role to its
// own panel (or to login), so it's the safest place to send people.

import NotFoundView from '@/components/shared/NotFoundView';
import EmployeeLogoMark from '@/components/employee/EmployeeLogoMark';

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col bg-background">
      <div className="flex justify-center pt-8" style={{ paddingTop: 'calc(2rem + env(safe-area-inset-top, 0px))' }}>
        <EmployeeLogoMark variant="color" className="w-28" />
      </div>
      <NotFoundView homeHref="/" />
    </main>
  );
}
