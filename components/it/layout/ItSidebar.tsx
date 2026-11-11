'use client';
// components/it/layout/ItSidebar.tsx
//
// Collapsible sidebar for the IT (super-admin) panel. Same structural
// pattern as FinanceSidebar/AuditSidebar, cyan-accented (IT's brand color).
//
// Sections are ordered by how often they are used, 2-4 items each. Headings are
// plain labels — every section is always fully shown (no section folding). Only
// the long sub-menus (Task Progress, Issues, Koreksi Setoran) are accordions.
//
//   Overview
//     Dashboard            /it
//     Task Progress >      Semua Task + one page per task (every store's progress on it)
//     Switch Role          /it/switch-role      (preview the app as another role)
//
//   Requests (what is waiting for IT)
//     Reset Password        /it/password-reset   ("Lupa password" queue; badge = waiting on IT)
//     Issues >              IT / Ops / Finance / Audit queues (IT can view them all)
//
//   People & Stores
//     Users                 /it/users            (create/edit accounts, assign roles)
//     Area Management       /it/areas            (rename areas, assign OPS Area users)
//     Store Management      /it/stores           (create/edit stores, assign employees/ops)
//
//   Operations Setup
//     Task Management        /it/task-management
//     Shift & Tasks           /it/shift-tasks
//     Pengaturan Visit        /it/store-visits
//     Performance Target Defaults /it/target-allocation (PIC1/PIC2/SA % grid)
//     Warehouse Codes         /it/warehouse-codes (BC location codes that are a warehouse, not a store)
//
//   Templates & Categories
//     Issue Templates         /it/issue-templates (report presets employees pick)
//     Email Templates         /it/email-templates (subject + HTML of outgoing emails)
//     On Hold Statement       /it/store-closing-hold (Store Closing On Hold: issue text + categories)
//     Petty Cash Categories   /it/petty-cash-categories
//
//   System
//     Feature Switches        /it/feature-switches (on/off for risky features, e.g. schedule "Delete everything")
//     BC Credentials           /it/bc-credentials
//     Profil & Keamanan        /it/settings
//
//   Data Correction (IT-only)
//     Koreksi Setoran > Koreksi         /it/setoran-correction (fix one day's amounts, carry-over recalculated)
//                       Riwayat Koreksi /it/setoran-correction/history (every correction, all stores)
//     Impact Visits         /ops/impact-visits (Ops can delete a draft; only IT deletes a submitted visit)
//     Reset Petty Cash      /it/petty-cash-reset (wipe one store's petty cash: one period or all periods)
//
//   Other Panels (IT keeps its role, a "Back to IT" banner shows on the way)
//     Ops Panel             /ops
//     Finance Panel         /finance
//     Audit Panel           /audit
//
// The icon-only rail shows every item (no headings, a divider between sections).

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import {
  AlertTriangle,
  BarChart3,
  Building2,
  CalendarCheck,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Eraser,
  FileCheck2,
  ClipboardList,
  KeyRound,
  Layers,
  Mail,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  MapPinned,
  PauseCircle,
  Percent,
  Repeat,
  RotateCcw,
  ShieldCheck,
  Store,
  Tags,
  ToggleRight,
  UserCog,
  Users,
  Wallet,
  Warehouse,
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
import { PASSWORD_RESET_CHANGED_EVENT } from '@/lib/password-reset';
import { PROGRESS_TASKS, progressTaskHref } from '@/lib/task-progress';

// ─── Nav definition ───────────────────────────────────────────────────────────

type NavChild = { href: string; label: string };

type NavItem = {
  href: string;
  label: string;
  icon: React.ElementType;
  exact?: boolean;
  /** Shows a count pill (see usePasswordResetBadge). */
  badge?: 'passwordReset';
  /** Sub-menu (accordion) - the first child is where clicking the item goes. */
  children?: NavChild[];
};

type NavSection = {
  section: string;
  items: NavItem[];
};

// Task Progress: one page per task (in the order a store works through them),
// each listing every store's progress on that task, needs-attention first.
const TASK_PROGRESS_ITEM: NavItem = {
  href: progressTaskHref(),
  label: 'Task Progress',
  icon: BarChart3,
  children: [
    { href: progressTaskHref(), label: 'Semua Task' },
    ...PROGRESS_TASKS.map((task) => ({ href: progressTaskHref(task.code), label: task.label })),
  ],
};

// Every role's issue queue in one place — IT sees them all, its own first.
const ISSUES_ITEM: NavItem = {
  href: '/it/issues',
  label: 'Issues',
  icon: AlertTriangle,
  children: [
    { href: '/it/issues', label: 'IT' },
    { href: '/ops/issues', label: 'Ops' },
    { href: '/finance/issues', label: 'Finance' },
    { href: '/audit/issues', label: 'Audit' },
  ],
};

const NAV: NavSection[] = [
  {
    section: 'Overview',
    items: [
      { href: '/it', label: 'Dashboard', icon: LayoutDashboard, exact: true },
      TASK_PROGRESS_ITEM,
      { href: '/it/switch-role', label: 'Switch Role', icon: Repeat },
    ],
  },
  {
    // What is waiting for IT, so it is the first thing under the dashboard.
    section: 'Requests',
    items: [
      { href: '/it/password-reset', label: 'Reset Password', icon: LockKeyhole, badge: 'passwordReset' },
      ISSUES_ITEM,
    ],
  },
  {
    section: 'People & Stores',
    items: [
      { href: '/it/users', label: 'Users', icon: Users },
      { href: '/it/areas', label: 'Area Management', icon: MapPinned },
      { href: '/it/stores', label: 'Store Management', icon: Building2 },
    ],
  },
  {
    section: 'Operations Setup',
    items: [
      { href: '/it/task-management', label: 'Task Management', icon: ClipboardCheck },
      { href: '/it/shift-tasks', label: 'Shift & Tasks', icon: Layers },
      { href: '/it/store-visits', label: 'Pengaturan Visit', icon: CalendarCheck },
      { href: '/it/target-allocation', label: 'Performance Target Defaults', icon: Percent },
      { href: '/it/warehouse-codes', label: 'Warehouse Codes', icon: Warehouse },
    ],
  },
  {
    section: 'Templates & Categories',
    items: [
      { href: '/it/issue-templates', label: 'Issue Templates', icon: ClipboardList },
      { href: '/it/email-templates', label: 'Email Templates', icon: Mail },
      { href: '/it/store-closing-hold', label: 'On Hold Statement', icon: PauseCircle },
      { href: '/it/petty-cash-categories', label: 'Petty Cash Categories', icon: Tags },
    ],
  },
  {
    section: 'System',
    items: [
      { href: '/it/feature-switches', label: 'Feature Switches', icon: ToggleRight },
      { href: '/it/bc-credentials', label: 'BC Credentials', icon: KeyRound },
      { href: '/it/settings', label: 'Profil & Keamanan', icon: UserCog },
    ],
  },
  {
    section: 'Data Correction',
    items: [
      {
        href: '/it/setoran-correction',
        label: 'Koreksi Setoran',
        icon: Eraser,
        children: [
          { href: '/it/setoran-correction', label: 'Koreksi' },
          { href: '/it/setoran-correction/history', label: 'Riwayat Koreksi' },
        ],
      },
      // Ops page — Ops can delete a draft; only IT may delete a submitted visit.
      { href: '/ops/impact-visits', label: 'Impact Visits', icon: FileCheck2 },
      { href: '/it/petty-cash-reset', label: 'Reset Petty Cash', icon: RotateCcw },
    ],
  },
  {
    section: 'Other Panels',
    items: [
      { href: '/ops', label: 'Ops Panel', icon: Store },
      { href: '/finance', label: 'Finance Panel', icon: Wallet },
      { href: '/audit', label: 'Audit Panel', icon: ShieldCheck },
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

// ─── Badge ────────────────────────────────────────────────────────────────────

/**
 * "Lupa password" requests waiting on IT (pending + expired/locked links).
 * Polled every minute while the tab is visible, on navigation, and right after
 * an action on the Reset Password page (PASSWORD_RESET_CHANGED_EVENT).
 */
async function fetchPasswordResetCount(): Promise<number | null> {
  try {
    const res = await fetch('/api/it/password-reset?count=1', { cache: 'no-store' });
    const json = await res.json();
    return json.success ? Number(json.count) || 0 : null;
  } catch {
    return null; // badge only — ignore
  }
}

function usePasswordResetBadge(enabled: boolean, pathname: string): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const refresh = () => {
      fetchPasswordResetCount().then((n) => {
        if (alive && n !== null) setCount(n);
      });
    };

    refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, 60_000);
    window.addEventListener(PASSWORD_RESET_CHANGED_EVENT, refresh);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener(PASSWORD_RESET_CHANGED_EVENT, refresh);
    };
  }, [enabled, pathname]);

  return count;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ItSidebar({ collapsed = false, userName = 'IT' }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = useSession();

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname.startsWith(href);

  // A group's children can nest (Task Progress > "Semua Task" is /it/task-progress, a
  // task is /it/task-progress/<code>): only the most specific match is lit.
  const activeChild = (children: NavChild[]) =>
    children
      .filter((c) => pathname === c.href || pathname.startsWith(`${c.href}/`))
      .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  // Accordion state, as in the Ops sidebar. Untouched, a group is open while you are
  // inside it; folding it by hand is remembered only for the page it was done on.
  const [fold, setFold] = useState<{ path: string; label: string; open: boolean } | null>(null);

  // An item is "inside" when its page, or any page of its sub-menu, is the current one
  // (Issues > Ops lives under /ops/issues, not under the group's own href).
  const itemActive = (item: NavItem) =>
    item.children
      ? item.children.some((c) => pathname === c.href || pathname.startsWith(`${c.href}/`))
      : isActive(item.href, item.exact);

  const groupOpen = (item: NavItem) =>
    fold && fold.path === pathname && fold.label === item.label ? fold.open : itemActive(item);

  function onGroupClick(item: NavItem) {
    // Already inside: just fold / unfold it. From outside: land on its first page.
    if (itemActive(item)) {
      setFold({ path: pathname, label: item.label, open: !groupOpen(item) });
      return;
    }
    router.push(item.children![0].href);
  }

  const resetCount = usePasswordResetBadge(session?.user?.role === 'it', pathname);
  const badgeFor = (badge: NavItem['badge']) => (badge === 'passwordReset' ? resetCount : 0);

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
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-cyan-600">
              <span className="text-xs font-bold text-white">IT</span>
            </div>
          ) : (
            <EmployeeLogoMark variant="color" className="w-32 shrink-0" />
          )}
          {!collapsed && (
            <div className="min-w-0 overflow-hidden">
              <p className="truncate text-xs font-semibold text-foreground">IT Panel</p>
              <p className="truncate text-[10px] text-muted-foreground">{displayName}</p>
            </div>
          )}
        </div>

        {/* ── Nav ── */}
        <nav className="flex-1 space-y-4 overflow-x-hidden overflow-y-auto px-2 py-3">
          {NAV.map(({ section, items }, index) => (
            // The icon-only rail has no headings: a thin divider marks where a section starts.
            <div key={section} className={cn(collapsed && index > 0 && 'border-t border-border pt-3')}>
              {!collapsed && (
                <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  {section}
                </p>
              )}
              <ul className="space-y-0.5">
                {items.map((item) => {
                  const { href, label, icon: Icon, badge, children } = item;
                  const active = itemActive(item);
                  const count = badgeFor(badge);
                  const linkCls = cn(
                    'flex items-center rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
                    collapsed ? 'justify-center' : 'gap-2.5',
                    active
                      ? 'bg-cyan-600/10 text-cyan-700'
                      : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                  );

                  // Accordion group (Task Progress > Semua Task / each task)
                  if (children) {
                    // The icon-only rail has no room for a sub-menu: the icon goes
                    // straight to the group's first page.
                    if (collapsed) {
                      return (
                        <li key={href}>
                          <NavTooltip label={label}>
                            <Link href={children[0].href} className={linkCls}>
                              <Icon className="h-4 w-4 shrink-0" />
                            </Link>
                          </NavTooltip>
                        </li>
                      );
                    }

                    const open = groupOpen(item);
                    const current = activeChild(children);
                    return (
                      <li key={href}>
                        <button
                          type="button"
                          onClick={() => onGroupClick(item)}
                          aria-expanded={open}
                          className={cn(linkCls, 'w-full')}
                        >
                          <Icon className="h-4 w-4 shrink-0" />
                          <span className="flex-1 text-left">{label}</span>
                          <ChevronDown className={cn('h-3.5 w-3.5 opacity-60 transition-transform', open && 'rotate-180')} />
                        </button>

                        {open && (
                          <ul className="ml-[1.15rem] mt-0.5 space-y-0.5 border-l border-border pl-2.5">
                            {children.map((child) => {
                              const on = current === child.href;
                              return (
                                <li key={child.href}>
                                  <Link
                                    href={child.href}
                                    aria-current={on ? 'page' : undefined}
                                    className={cn(
                                      'flex items-center rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors',
                                      on
                                        ? 'bg-cyan-600/10 text-cyan-700'
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

                  return (
                    <li key={href}>
                      {collapsed ? (
                        <NavTooltip label={count > 0 ? `${label} · ${count} menunggu` : label}>
                          <Link href={href} className={cn(linkCls, 'relative')}>
                            <Icon className="h-4 w-4 shrink-0" />
                            {count > 0 && (
                              <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-rose-500 ring-2 ring-card" />
                            )}
                          </Link>
                        </NavTooltip>
                      ) : (
                        <Link href={href} className={linkCls}>
                          <Icon className="h-4 w-4 shrink-0" />
                          <span className="flex-1">{label}</span>
                          {count > 0 && (
                            <span
                              className="min-w-5 rounded-full bg-rose-500 px-1.5 py-px text-center text-[10px] font-bold tabular-nums text-white"
                              aria-label={`${count} menunggu`}
                            >
                              {count > 99 ? '99+' : count}
                            </span>
                          )}
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
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-cyan-50 text-xs font-semibold text-cyan-700 hover:bg-red-50 hover:text-red-600 transition-colors"
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
                  fallbackClassName="bg-cyan-50 text-xs text-cyan-700"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-foreground">{displayName}</p>
                  <p className="truncate text-[10px] text-muted-foreground">
                    {session?.user && 'nik' in session.user && (session.user as { nik?: string }).nik
                      ? `NIK ${(session.user as { nik: string }).nik}`
                      : 'IT'}
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
