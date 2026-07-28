'use client';
// components/finance/layout/FinanceSidebar.tsx
//
// Collapsible sidebar for the Finance panel.
// Mirrors the structure of OpsSidebar but with finance-specific nav items:
//
//   Overview
//     Dashboard         /finance
//
//   Cash & Reports
//     Petty Cash        /finance/petty-cash          (approve/review transactions)
//     Daily Reports     /finance/daily-reports        (setoran, EOD verification)
//     Setoran Review    /finance/setoran              (money-storage discrepancy review)
//
//   Issues
//     Issues            /finance/issues               (issues routed to Finance role)
//
// All routes live under app/finance/ and are protected by the Finance role
// guard in middleware / page-level checks.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import {
  AlertTriangle,
  ChevronRight,
  FileText,
  LayoutDashboard,
  LogOut,
  PocketKnife,
  Wallet,
  WalletCards,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import EmployeeLogoMark from '@/components/employee/EmployeeLogoMark';

// ─── Nav definition ───────────────────────────────────────────────────────────

type NavItem = {
  href: string;
  label: string;
  icon: React.ElementType;
  exact?: boolean;
};

type NavSection = {
  section: string;
  items: NavItem[];
};

const NAV: NavSection[] = [
  {
    section: 'Overview',
    items: [
      { href: '/finance', label: 'Dashboard', icon: LayoutDashboard, exact: true },
    ],
  },
  {
    section: 'Cash & Reports',
    items: [
      { href: '/finance/petty-cash',    label: 'Petty Cash',     icon: Wallet },
      { href: '/finance/setoran',       label: 'Setoran Review', icon: WalletCards },
      { href: '/finance/uang-modal',       label: 'Uang Modal Harian', icon: PocketKnife },
    ],
  },
  {
    section: 'Issues',
    items: [
      { href: '/finance/issues', label: 'Issues', icon: AlertTriangle },
    ],
  },
];

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  collapsed?: boolean;
  userName?: string;
}

// ─── Tooltip helper ───────────────────────────────────────────────────────────

function NavTooltip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right" className="text-xs font-semibold">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function FinanceSidebar({ collapsed = false, userName = 'Finance' }: Props) {
  const pathname = usePathname();
  const { data: session } = useSession();

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname.startsWith(href);

  const displayName = session?.user?.name ?? userName;
  const initial     = displayName.charAt(0).toUpperCase();

  return (
    <TooltipProvider delayDuration={120}>
      <aside
        className={cn(
          'flex h-screen flex-col border-r border-border bg-card transition-all duration-200 ease-in-out overflow-hidden',
          collapsed ? 'w-16' : 'w-64',
        )}
      >
        {/* ── Brand ── */}
        <div className="flex items-center gap-2 px-3 py-5 min-w-0">
          {collapsed ? (
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-600">
              <span className="text-xs font-bold text-white">FN</span>
            </div>
          ) : (
            <EmployeeLogoMark variant="color" className="w-32 shrink-0" />
          )}
          {!collapsed && (
            <div className="min-w-0 overflow-hidden">
              <p className="truncate text-xs font-semibold text-foreground">Finance Panel</p>
              <p className="truncate text-[10px] text-muted-foreground">{displayName}</p>
            </div>
          )}
        </div>

        {/* ── Nav ── */}
        <nav className="flex-1 space-y-5 overflow-x-hidden overflow-y-auto px-2 py-4">
          {NAV.map(({ section, items }) => (
            <div key={section}>
              {!collapsed && (
                <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  {section}
                </p>
              )}
              <ul className="space-y-0.5">
                {items.map(({ href, label, icon: Icon, exact }) => {
                  const active = isActive(href, exact);
                  const linkCls = cn(
                    'flex items-center rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
                    collapsed ? 'justify-center' : 'gap-2.5',
                    active
                      ? 'bg-emerald-600/10 text-emerald-700'
                      : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                  );

                  return (
                    <li key={href}>
                      {collapsed ? (
                        <NavTooltip label={label}>
                          <Link href={href} className={linkCls}>
                            <Icon className="h-4 w-4 shrink-0" />
                          </Link>
                        </NavTooltip>
                      ) : (
                        <Link href={href} className={linkCls}>
                          <Icon className="h-4 w-4 shrink-0" />
                          <span className="flex-1">{label}</span>
                          {active && <ChevronRight className="h-3 w-3 opacity-60" />}
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* ── Footer ── */}
        <div className="border-t border-border px-2 py-3">
          <div className={cn('flex items-center rounded-md px-2 py-2', collapsed ? 'justify-center' : 'gap-2.5')}>
            {collapsed ? (
              <NavTooltip label={`${displayName} · Logout`}>
                <button
                  onClick={() => signOut({ callbackUrl: '/login' })}
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-50 text-xs font-semibold text-emerald-700 hover:bg-red-50 hover:text-red-600 transition-colors"
                >
                  {initial}
                </button>
              </NavTooltip>
            ) : (
              <>
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-xs font-semibold text-emerald-700">
                  {initial}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-foreground">{displayName}</p>
                  <p className="truncate text-[10px] text-muted-foreground">
                    {session?.user && 'nik' in session.user && (session.user as { nik?: string }).nik
                      ? `NIK ${(session.user as { nik: string }).nik}`
                      : 'Finance'}
                  </p>
                </div>
                <button
                  onClick={() => signOut({ callbackUrl: '/login' })}
                  className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  title="Log out"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </>
            )}
          </div>
        </div>
      </aside>
    </TooltipProvider>
  );
}