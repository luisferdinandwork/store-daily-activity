'use client';
// components/audit/stock-opname/SoTabs.tsx — the page tabs of the Audit "Cek Bin & Stock Opname" section:
// Hasil Cek Bin (period report) · Stock Opname (the count of one store-day) · Berita Acara SO (list + print).

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ClipboardCheck, FileText, ScanLine } from 'lucide-react';

import { cn } from '@/lib/utils';

const TABS = [
  { href: '/audit/cek-bin', label: 'Hasil Cek Bin', short: 'Cek Bin', icon: ScanLine, keepQuery: false },
  { href: '/audit/stock-opname', label: 'Stock Opname', short: 'SO', icon: ClipboardCheck, keepQuery: true },
  { href: '/audit/berita-acara-so', label: 'Berita Acara SO', short: 'BA SO', icon: FileText, keepQuery: false },
] as const;

export default function SoTabs({ query = '' }: { query?: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Cek Bin & Stock Opname" className="-mb-px flex gap-1 overflow-x-auto">
      {TABS.map(({ href, label, short, icon: Icon, keepQuery }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={`${href}${keepQuery ? query : ''}`}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex min-h-10 shrink-0 items-center gap-1.5 border-b-2 px-3 text-sm font-semibold transition-colors',
              active ? 'border-amber-500 text-amber-700' : 'border-transparent text-slate-500 hover:text-slate-800',
            )}
          >
            <Icon className="h-4 w-4" />
            <span className="sm:hidden">{short}</span>
            <span className="hidden sm:inline">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
