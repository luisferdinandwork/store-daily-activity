'use client';
// components/ops/store-visits/VisitTabs.tsx
//
// The three pages of Visit Toko as one segmented switch — "Visits" (the stores + the visit
// form), "Upcoming" (which store is due next, by days left) and "Report" (the visits that
// were made, and the periods that were missed). Sits at the top of every page, full width
// on a phone.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BarChart3, CalendarClock, Store } from 'lucide-react';

import { cn } from '@/lib/utils';

const TABS = [
  { href: '/ops/store-visits', label: 'Visits', Icon: Store },
  { href: '/ops/store-visits/upcoming', label: 'Upcoming', Icon: CalendarClock },
  { href: '/ops/store-visits/report', label: 'Report', Icon: BarChart3 },
] as const;

export default function VisitTabs({ className }: { className?: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Visit Toko" className={cn('flex rounded-2xl bg-slate-200/60 p-1 sm:inline-flex', className)}>
      {TABS.map(({ href, label, Icon }) => {
        // "Visits" also owns the per-store visit form (/ops/store-visits/<id>).
        const active = href === '/ops/store-visits'
          ? pathname === href || !TABS.some((t) => t.href !== href && pathname.startsWith(t.href))
          : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex h-10 flex-1 items-center justify-center gap-2 rounded-xl px-4 text-sm font-bold transition sm:flex-none sm:px-5',
              active ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700',
            )}
          >
            <Icon className="h-4 w-4" />{label}
          </Link>
        );
      })}
    </nav>
  );
}
