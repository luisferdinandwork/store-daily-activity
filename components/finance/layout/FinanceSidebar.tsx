'use client';
// components/finance/layout/FinanceSidebar.tsx
//
// Collapsible sidebar for the Finance panel.
// Mirrors the structure of OpsSidebar but with finance-specific nav items.
// Areas with two views (Review + Report) are accordion groups: clicking the
// group opens it and goes to its first page; the sub-menu stays open while
// you are anywhere inside it.
//
//   Overview
//     Dashboard             /finance
//
//   Cash & Reports
//     Petty Cash  ▸ Monitoring  /finance/petty-cash          (balances, spend, refill requests + verify)
//                 ▸ Transactions /finance/petty-cash/transactions (every request; filter by store + period)
//                 ▸ Report      /finance/petty-cash/report   (usage + refill bank account, Excel)
//     Setoran     ▸ Review      /finance/setoran             (daily review: photos, verify, Excel)
//                 ▸ Report      /finance/setoran/report      (monthly totals per store, Excel)
//     Uang Modal  ▸ Review      /finance/uang-modal          (daily opening-float check, verify, Excel)
//                 ▸ Report      /finance/uang-modal/report   (monthly fill rate per store, Excel)
//
//   Operations
//     Store Closing             /finance/store-closing       (Z-Report & EDC photo, statement posted / on hold)
//
//   Issues
//     Issues                    /finance/issues              (issues routed to Finance role)
//
// All routes live under app/finance/ and are protected by the Finance role
// guard in middleware / page-level checks.

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Coins,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Store,
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
import UserAvatar from '@/components/shared/UserAvatar';

// ─── Nav definition ───────────────────────────────────────────────────────────

type NavLeaf = {
  href: string;
  label: string;
  icon: React.ElementType;
  exact?: boolean;
};

type NavChild = { href: string; label: string; exact?: boolean };

type NavGroup = {
  label: string;
  icon: React.ElementType;
  /** Sub-menu — the first child is where clicking the group goes. */
  children: NavChild[];
};

type NavEntry = NavLeaf | NavGroup;

type NavSection = {
  section: string;
  items: NavEntry[];
};

const isGroup = (e: NavEntry): e is NavGroup => 'children' in e;

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
      {
        label: 'Petty Cash',
        icon: Wallet,
        children: [
          { href: '/finance/petty-cash', label: 'Monitoring', exact: true },
          { href: '/finance/petty-cash/transactions', label: 'Transactions' },
          { href: '/finance/petty-cash/report', label: 'Report' },
        ],
      },
      {
        label: 'Setoran',
        icon: WalletCards,
        children: [
          { href: '/finance/setoran', label: 'Review', exact: true },
          { href: '/finance/setoran/report', label: 'Report' },
        ],
      },
      {
        label: 'Uang Modal',
        icon: Coins,
        children: [
          { href: '/finance/uang-modal', label: 'Review', exact: true },
          { href: '/finance/uang-modal/report', label: 'Report' },
        ],
      },
    ],
  },
  {
    section: 'Operations',
    items: [
      { href: '/finance/store-closing', label: 'Store Closing', icon: Store },
    ],
  },
  {
    section: 'Issues',
    items: [
      { href: '/finance/issues', label: 'Issues', icon: AlertTriangle },
    ],
  },
  {
    section: 'Akun',
    items: [
      { href: '/finance/settings', label: 'Profil & Keamanan', icon: KeyRound },
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
  const router = useRouter();
  const { data: session } = useSession();

  // Accordion state. Untouched, the open group simply follows the route (the
  // group you're on is open, the rest are closed). Folding the current group by
  // hand is remembered only for the page it was done on — navigating anywhere
  // resets to "follow the route", so one group is open at a time.
  const [fold, setFold] = useState<{ path: string; label: string; open: boolean } | null>(null);

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname.startsWith(href);

  const childActive = (c: NavChild) => isActive(c.href, c.exact);
  const groupActive = (g: NavGroup) => g.children.some(childActive);
  const groupOpen = (g: NavGroup) =>
    fold && fold.path === pathname && fold.label === g.label ? fold.open : groupActive(g);

  function onGroupClick(g: NavGroup) {
    // Already inside the group → just fold / unfold it. From outside → land on
    // its first page (the route then opens it and closes the previous group).
    if (groupActive(g)) {
      setFold({ path: pathname, label: g.label, open: !groupOpen(g) });
      return;
    }
    router.push(g.children[0].href);
  }

  const displayName = session?.user?.name ?? userName;
  const initial     = displayName.charAt(0).toUpperCase();

  const rowCls = (active: boolean) =>
    cn(
      'flex w-full items-center rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
      collapsed ? 'justify-center' : 'gap-2.5',
      active
        ? 'bg-emerald-600/10 text-emerald-700'
        : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
    );

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
                {items.map((entry) => {
                  // ── Accordion group ──
                  if (isGroup(entry)) {
                    const Icon = entry.icon;
                    const active = groupActive(entry);
                    const open = groupOpen(entry);

                    // Icon-only rail has no room for a sub-menu: the icon goes
                    // straight to the group's first page.
                    if (collapsed) {
                      return (
                        <li key={entry.label}>
                          <NavTooltip label={entry.label}>
                            <Link href={entry.children[0].href} className={rowCls(active)}>
                              <Icon className="h-4 w-4 shrink-0" />
                            </Link>
                          </NavTooltip>
                        </li>
                      );
                    }

                    return (
                      <li key={entry.label}>
                        <button
                          type="button"
                          onClick={() => onGroupClick(entry)}
                          aria-expanded={open}
                          className={rowCls(active)}
                        >
                          <Icon className="h-4 w-4 shrink-0" />
                          <span className="flex-1 text-left">{entry.label}</span>
                          <ChevronDown
                            className={cn('h-3.5 w-3.5 opacity-60 transition-transform', open && 'rotate-180')}
                          />
                        </button>

                        {open && (
                          <ul className="ml-[1.15rem] mt-0.5 space-y-0.5 border-l border-border pl-2.5">
                            {entry.children.map((child) => {
                              const on = childActive(child);
                              return (
                                <li key={child.href}>
                                  <Link
                                    href={child.href}
                                    aria-current={on ? 'page' : undefined}
                                    className={cn(
                                      'flex items-center rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors',
                                      on
                                        ? 'bg-emerald-600/10 text-emerald-700'
                                        : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                                    )}
                                  >
                                    <span className="flex-1">{child.label}</span>
                                    {on && <ChevronRight className="h-3 w-3 opacity-60" />}
                                  </Link>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </li>
                    );
                  }

                  // ── Single link ──
                  const { href, label, icon: Icon, exact } = entry;
                  const active = isActive(href, exact);
                  const linkCls = rowCls(active);

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
                <UserAvatar
                  src={session?.user?.image}
                  name={displayName}
                  className="h-7 w-7 shrink-0"
                  fallbackClassName="bg-emerald-50 text-xs text-emerald-700"
                />
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
