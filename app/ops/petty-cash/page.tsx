// app/ops/petty-cash/page.tsx
//
// Petty Cash used to be one page; it is now two — /ops/petty-cash/requests
// (spending) and /ops/petty-cash/refills (top-ups). The bare URL still lands
// somewhere sensible for old bookmarks and notifications.

import { redirect } from 'next/navigation';

export default function OpsPettyCashIndex() {
  redirect('/ops/petty-cash/requests');
}
