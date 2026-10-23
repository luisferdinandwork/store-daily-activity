'use client';
// components/ops/store-visits/VisitTabs.tsx
//
// The two pages of Visit Toko as one segmented switch — "Daftar toko" (the stores + the visit
// form) and "Report" (which store next). Sits at the top of both pages, full width on a phone.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BarChart3, Store } from 'lucide-react';

import { cn } from '@/lib/utils';

const TABS = [
  { href: '/ops/store-visits', label: 'Daftar toko', Icon: Store },
  { href: '/ops/store-visits/report', label: 'Report', Icon: BarChart3 },
] as const;

export default function VisitTabs({ className }: { className?: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Visit Toko" className={cn('flex rounded-2xl bg-slate-200/60 p-1 sm:inline-flex', className)}>
      {TABS.map(({ href, label, Icon }) => {
        const active = href === '/ops/store-visits/report' ? pathname.startsWith(href) : pathname === href;
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex h-10 flex-1 items-center justify-center gap-2 rounded-xl px-5 text-sm font-bold transition sm:flex-none',
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
