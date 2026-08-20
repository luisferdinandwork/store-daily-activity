'use client';
// components/employee/EmployeeItemTransfersBadge.tsx
//
// Header shortcut to /employee/item-transfers with a live pending-count
// badge — polls the lightweight, DB-only count endpoint (no BC sync, safe to
// poll often) so employees notice a new drop-off/return waiting on them
// without having to check the page itself.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Truck } from 'lucide-react';

const POLL_INTERVAL_MS = 60_000;

export default function EmployeeItemTransfersBadge() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch('/api/employee/item-transfers/pending-count', { cache: 'no-store' });
        const json = await res.json();
        if (!cancelled && json?.success) setCount(json.count ?? 0);
      } catch {
        // Silent — the badge just stays at its last known count.
      }
    }

    void load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <Link
      href="/employee/item-transfers"
      aria-label={count > 0 ? `Item Transfers, ${count} pending` : 'Item Transfers'}
      className="relative flex h-11 w-11 items-center justify-center rounded-full text-primary-foreground/90 transition-colors hover:bg-white/10 active:scale-95"
    >
      <Truck className="h-[18px] w-[18px]" />
      {count > 0 && (
        <span className="absolute right-2 top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold leading-none text-white ring-2 ring-primary">
          {count > 9 ? '9+' : count}
        </span>
      )}
    </Link>
  );
}
