// app/employee/settings/page.tsx
//
// Settings merged into the Profile page (account info + profile picture +
// password). Kept as a redirect so old links, bookmarks and the 90-day
// password-expiry deep link still resolve.

import { redirect } from 'next/navigation';

export default function EmployeeSettingsPage() {
  redirect('/employee/profile');
}
