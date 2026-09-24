// app/employee/not-found.tsx
//
// Not-found inside the employee app — rendered within the employee layout, so
// the app bar and bottom nav stay and the person is one tap from anywhere.
// Unknown /employee/* URLs reach it via app/employee/[...slug]/page.tsx.

import NotFoundView from '@/components/shared/NotFoundView';

export default function EmployeeNotFound() {
  return <NotFoundView homeHref="/employee" homeLabel="Ke Beranda" />;
}
