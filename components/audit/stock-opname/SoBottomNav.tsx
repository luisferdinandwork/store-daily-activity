'use client';
// components/audit/stock-opname/SoBottomNav.tsx — the phone tab bar of the Audit "Cek Bin & Stock Opname" group.
//
// On a phone the four pages are reached from a bottom bar (thumb reach, no header tab row eating the screen);
// from `md` the header tabs (SoTabs) take over and this bar renders nothing. AuditShell passes it as the panel's
// `footer`, so it sits OUTSIDE the scrolling page: the pages' sticky save bars end right above it.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ClipboardCheck, FileText, ListChecks, ScanLine } from 'lucide-react';

import { cn } from '@/lib/utils';

const ITEMS = [
  { href: '/audit/cek-bin', label: 'Hasil Cek Bin', icon: ScanLine },
  { href: '/audit/bin-progress', label: 'Progres Bin', icon: ListChecks },
  { href: '/audit/stock-opname', label: 'Stock Opname', icon: ClipboardCheck },
  { href: '/audit/berita-acara-so', label: 'Berita Acara', icon: FileText },
] as const;

/** Only the pages of the group show the bar. */
const inGroup = (pathname: string) => ITEMS.some(({ href }) => pathname === href || pathname.startsWith(`${href}/`));

export default function SoBottomNav() {
  const pathname = usePathname();
  if (!inGroup(pathname)) return null;
  return (
    <nav
      aria-label="Cek Bin & Stock Opname"
      className="z-30 grid shrink-0 grid-cols-4 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] shadow-[0_-6px_20px_-12px_rgba(15,23,42,0.25)] md:hidden"
    >
      {ITEMS.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-bold transition-colors active:bg-amber-50',
              active ? 'text-amber-700' : 'text-slate-500',
            )}
          >
            <span className={cn('flex h-7 w-12 items-center justify-center rounded-full transition-colors', active && 'bg-amber-100')}>
              <Icon className="h-[18px] w-[18px]" />
            </span>
            <span className="truncate">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
