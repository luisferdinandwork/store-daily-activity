// app/employee/[...slug]/page.tsx
//
// Catch-all for /employee/* URLs no real page matches. Without it Next shows
// the root not-found page, outside the employee shell; calling notFound()
// here renders app/employee/not-found.tsx inside it instead. Real routes are
// more specific, so they always win over this one.

import { notFound } from 'next/navigation';

export default function EmployeeUnknownPage() {
  notFound();
}
