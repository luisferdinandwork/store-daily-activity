'use client';
// components/ops/layout/OpsMobileChrome.tsx
//
// The Ops panel on a phone (below `md`), wired up in app/ops/OpsShell.tsx:
//
//   OpsMobileTopBar   brand + bell + profile (the desktop sidebar/navbar hide)
//   OpsDesktopHint    "Buka di desktop untuk pengalaman lebih baik" — a banner that
//                     stays put on every page not built for phones
//   OpsMobileTabBar   Dashboard · Issues · Petty Cash (with "waiting" badges) ·
//                     Menu (the full sidebar in a drawer)
//
// Which pages count as phone-ready: lib/ops-mobile.ts.

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AlertTriangle, ClipboardCheck, LayoutDashboard, LayoutGrid, Monitor, Wallet } from 'lucide-react';

import { cn } from '@/lib/utils';
import { OPS_DESKTOP_HINT, isOpsMobileReady } from '@/lib/ops-mobile';
import EmployeeLogoMark from '@/components/employee/EmployeeLogoMark';
import OpsSidebar from '@/components/ops/layout/OpsSidebar';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';

// ─── Top bar ─────────────────────────────────────────────────────────────────

export function OpsMobileTopBar({ right }: { right?: ReactNode }) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-3 md:hidden">
      <Link href="/ops" aria-label="Ops Dashboard" className="flex items-center gap-2">
        <EmployeeLogoMark variant="color" className="w-[84px]" />
        <span className="rounded-md bg-indigo-50 px-1.5 py-0.5 text-[10px] font-black tracking-wider text-indigo-600">
          OPS
        </span>
      </Link>
      <div className="ml-auto flex items-center gap-1.5">{right}</div>
    </header>
  );
}

// ─── "Open on desktop" banner ────────────────────────────────────────────────

export function OpsDesktopHint() {
  const pathname = usePathname();
  if (isOpsMobileReady(pathname)) return null;

  return (
    <div
      role="status"
      className="flex shrink-0 items-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2.5 md:hidden"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-amber-600 shadow-sm ring-1 ring-amber-200">
        <Monitor className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className="text-[13px] font-bold leading-snug text-amber-900">{OPS_DESKTOP_HINT}</p>
        <p className="text-[11px] leading-snug text-amber-800/80">Halaman ini dirancang untuk layar lebar.</p>
      </div>
    </div>
  );
}

// ─── Bottom tab bar ──────────────────────────────────────────────────────────

/** What's waiting on Ops — refetched on every page change (phones only). */
function useWaitingCounts(pathname: string) {
  const [counts, setCounts] = useState({ issues: 0, pettyCash: 0 });

  useEffect(() => {
    let stale = false;
    Promise.all([
      fetch('/api/ops/issues/summary', { cache: 'no-store' }).then((r) => r.json()).catch(() => null),
      fetch('/api/ops/petty-cash/summary', { cache: 'no-store' }).then((r) => r.json()).catch(() => null),
    ]).then(([iss, pc]) => {
      if (stale) return;
      setCounts((prev) => ({
        issues: iss?.success ? Number(iss.unreviewed) || 0 : prev.issues,
        pettyCash: pc?.success ? (Number(pc.pending?.requests) || 0) + (Number(pc.pending?.refills) || 0) : prev.pettyCash,
      }));
    });
    return () => {
      stale = true;
    };
  }, [pathname]);

  return counts;
}

function TabBadge({ count, tone }: { count: number; tone: 'rose' | 'amber' }) {
  if (count <= 0) return null;
  return (
    <span
      className={cn(
        'absolute -top-1 right-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-black tabular-nums text-white ring-2 ring-white',
        tone === 'rose' ? 'bg-rose-500' : 'bg-amber-500',
      )}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}

function TabItem({
  label,
  icon: Icon,
  active,
  badge,
}: {
  label: string;
  icon: typeof Wallet;
  active: boolean;
  badge?: ReactNode;
}) {
  return (
    <>
      <span
        className={cn(
          'relative flex h-8 w-14 items-center justify-center rounded-full transition-colors',
          active ? 'bg-indigo-100 text-indigo-700' : 'text-slate-500',
        )}
      >
        <Icon className="h-5 w-5" strokeWidth={active ? 2.4 : 2} />
        {badge}
      </span>
      <span className={cn('text-[11px] font-semibold leading-none', active ? 'text-indigo-700' : 'text-slate-500')}>
        {label}
      </span>
    </>
  );
}

const TAB_LINK = 'flex flex-col items-center gap-1 pb-2 pt-2.5 outline-none focus-visible:bg-slate-50 active:opacity-70';

export function OpsMobileTabBar() {
  const pathname = usePathname();
  const counts = useWaitingCounts(pathname);
  // Open while on the page it was opened from — any navigation closes it.
  const [menuAt, setMenuAt] = useState<string | null>(null);
  const menuOpen = menuAt === pathname;

  const onDashboard = pathname === '/ops';
  const onIssues = pathname === '/ops/issues' || pathname.startsWith('/ops/issues/');
  const onPettyCash = pathname === '/ops/petty-cash' || pathname.startsWith('/ops/petty-cash/');
  const onVisitResults = pathname === '/ops/impact-visits/results' || pathname.startsWith('/ops/impact-visits/results/');

  return (
    <>
      <nav
        aria-label="Ops mobile"
        className="shrink-0 border-t border-slate-200 bg-white/95 backdrop-blur md:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <ul className="grid grid-cols-5 px-1">
          <li>
            <Link href="/ops" aria-current={onDashboard ? 'page' : undefined} className={TAB_LINK}>
              <TabItem label="Dashboard" icon={LayoutDashboard} active={onDashboard} />
            </Link>
          </li>
          <li>
            <Link href="/ops/issues" aria-current={onIssues ? 'page' : undefined} className={TAB_LINK}>
              <TabItem
                label="Issues"
                icon={AlertTriangle}
                active={onIssues}
                badge={<TabBadge count={counts.issues} tone="rose" />}
              />
            </Link>
          </li>
          <li>
            <Link href="/ops/petty-cash/requests" aria-current={onPettyCash ? 'page' : undefined} className={TAB_LINK}>
              <TabItem
                label="Petty Cash"
                icon={Wallet}
                active={onPettyCash}
                badge={<TabBadge count={counts.pettyCash} tone="amber" />}
              />
            </Link>
          </li>
          <li>
            <Link href="/ops/impact-visits/results" aria-current={onVisitResults ? 'page' : undefined} className={TAB_LINK}>
              <TabItem label="Hasil Visit" icon={ClipboardCheck} active={onVisitResults} />
            </Link>
          </li>
          <li>
            <button
              type="button"
              onClick={() => setMenuAt(pathname)}
              aria-expanded={menuOpen}
              className={cn(TAB_LINK, 'w-full')}
            >
              <TabItem
                label="Menu"
                icon={LayoutGrid}
                active={menuOpen || !isOpsMobileReady(pathname)}
              />
            </button>
          </li>
        </ul>
      </nav>

      {/* Every other Ops page, via the full sidebar */}
      <Sheet open={menuOpen} onOpenChange={(open) => setMenuAt(open ? pathname : null)}>
        <SheetContent side="left" showCloseButton={false} className="w-[17rem] gap-0 p-0 sm:max-w-[17rem]">
          <SheetTitle className="sr-only">Ops menu</SheetTitle>
          <div
            className="h-full"
            onClickCapture={(e) => {
              if ((e.target as HTMLElement).closest('a')) setMenuAt(null);
            }}
          >
            <OpsSidebar drawer />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
