'use client';
// components/ops/layout/OpsSidebar.tsx

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import {
  AlertTriangle,
  BarChart3,
  BookOpen,
  Calendar,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  FileCheck2,
  KeyRound,
  LayoutDashboard,
  LogOut,
  MapPinned,
  Monitor,
  ReceiptText,
  Store,
  Target,
  Truck,
  UserCheck,
  Users,
  Wallet,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { isOpsMobileReady } from '@/lib/ops-mobile';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import EmployeeLogoMark from '@/components/employee/EmployeeLogoMark';
import UserAvatar from '@/components/shared/UserAvatar';

// ─── Nav data ─────────────────────────────────────────────────────────────────

const TASK_PROGRESS_ITEM = {
  href: '/ops/tasks/progress',
  label: 'Task Progress',
  icon: BarChart3,
  key: 'progress',
};

// New: employee performance target management. HO Ops sees all areas/stores,
// Area Ops is scoped to their assigned area (resolved server-side).
const PERFORMANCE_TARGETS_ITEM = {
  href: '/ops/performance-targets',
  label: 'Performance Targets',
  icon: Target,
  key: 'performance-targets',
};

// Item Return → Shipping → Item Receiving BC pipeline dashboard.
const ITEM_TRANSFERS_ITEM = {
  href: '/ops/transfer-order',
  label: 'Transfer Orders',
  icon: Truck,
  key: 'item-transfers',
};

// OPS HO only — assign the one OPS Area user per area, rename areas, move
// stores between areas, and monitor task/attendance rolled up per area.
const AREA_MANAGEMENT_ITEM = {
  href: '/ops/areas',
  label: 'Area Management',
  icon: MapPinned,
  key: 'area-management',
};


// OPS HO only — manage the Knowledge Base library employees see.
const MANUALS_ITEM = {
  href: '/ops/manuals',
  label: 'Knowledge Base',
  icon: BookOpen,
  key: 'manuals',
};

type NavChild = { href: string; label: string };

type NavItem = {
  href: string;
  label: string;
  icon: React.ElementType;
  exact?: boolean;
  /** Sub-menu (accordion) — the first child is where clicking the item goes. */
  children?: NavChild[];
};

type NavSection = { section: string; items: NavItem[] };

// Digitized store-visit audit (paper "OPS Impact Visit" form): the visits
// themselves, and the month-by-month report on its own page. Both ops_area (own
// area) and ops_ho (all areas) can fill/view — area scoping is enforced
// server-side, not by hiding this nav item.
const IMPACT_VISIT_ITEM: NavItem = {
  href: '/ops/impact-visits',
  label: 'Impact Visit',
  icon: FileCheck2,
  children: [
    { href: '/ops/impact-visits', label: 'Visits' },
    { href: '/ops/impact-visits/results', label: 'Hasil Visit' },
    { href: '/ops/impact-visits/report', label: 'Monthly Report' },
  ],
};

// Petty Cash is two pages: spending requests and top-up (refill) requests.
const PETTY_CASH_ITEM: NavItem = {
  href: '/ops/petty-cash',
  label: 'Petty Cash',
  icon: Wallet,
  children: [
    { href: '/ops/petty-cash/requests', label: 'Requests' },
    { href: '/ops/petty-cash/refills', label: 'Refills' },
  ],
};

const NAV: NavSection[] = [
  {
    section: 'Overview',
    items: [
      { href: '/ops',        label: 'Dashboard', icon: LayoutDashboard, exact: true },
      { href: '/ops/stores', label: 'Stores',    icon: Store },
    ],
  },
  {
    section: 'People',
    items: [
      { href: '/ops/schedules',  label: 'Schedules',  icon: Calendar },
      { href: '/ops/attendance', label: 'Attendance', icon: UserCheck },
      { href: '/ops/employees',  label: 'Employees',  icon: Users },
      { href: '/ops/manage',     label: 'Manage',     icon: ClipboardCheck },
    ],
  },
  {
    section: 'Operations',
    items: [
      { href: '/ops/issues',               label: 'Issues',               icon: AlertTriangle },
      IMPACT_VISIT_ITEM,
      PETTY_CASH_ITEM,
      { href: '/ops/sales-returns',          label: 'Sales Return',         icon: ReceiptText },
      { href: ITEM_TRANSFERS_ITEM.href,    label: ITEM_TRANSFERS_ITEM.label, icon: ITEM_TRANSFERS_ITEM.icon },
      { href: PERFORMANCE_TARGETS_ITEM.href, label: PERFORMANCE_TARGETS_ITEM.label, icon: PERFORMANCE_TARGETS_ITEM.icon },
    ],
  },
  {
    section: 'Akun',
    items: [
      { href: '/ops/settings', label: 'Profil & Keamanan', icon: KeyRound },
    ],
  },
];

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  storeName?: string;
  /** Controlled collapse state from OpsNavbar. If omitted the sidebar manages itself. */
  collapsed?: boolean;
  /**
   * Inside the phone's Menu drawer (OpsMobileChrome): fills the drawer, and marks
   * the pages that aren't built for phones with a small monitor icon.
   */
  drawer?: boolean;
}

// ─── Tooltip helper for collapsed mode ───────────────────────────────────────

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

export default function OpsSidebar({ storeName = 'Ops', collapsed = false, drawer = false }: Props) {
  const pathname   = usePathname();
  const router     = useRouter();
  const { data: session } = useSession();

  const isOpsHo = session?.user?.isOpsHo === true;

  // NAV[0] (Overview) renders separately below; the rest — People, Operations —
  // render via this array, with an OPS-HO-only "OPS HQ" section spliced in right
  // after Overview. IT-only configuration (Task Management, Shift & Tasks, BC
  // Credentials) now lives in the /it panel, not here.
  const restSections = useMemo<NavSection[]>(() => {
    return isOpsHo
      ? [{ section: 'OPS HQ', items: [AREA_MANAGEMENT_ITEM, MANUALS_ITEM] }, ...NAV.slice(1)]
      : NAV.slice(1);
  }, [isOpsHo]);

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname.startsWith(href);

  // A group's children can nest (Impact Visit's "Visits" is /ops/impact-visits,
  // its report /ops/impact-visits/report): only the most specific match is lit.
  const activeChild = (children: NavChild[]) =>
    children
      .filter((c) => pathname === c.href || pathname.startsWith(`${c.href}/`))
      .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  // Accordion state, as in the Finance sidebar. Untouched, a group is open while
  // you are inside it; folding it by hand is remembered only for the page it was
  // done on — navigating anywhere goes back to "follow the route".
  const [fold, setFold] = useState<{ path: string; label: string; open: boolean } | null>(null);

  const groupOpen = (item: NavItem) =>
    fold && fold.path === pathname && fold.label === item.label ? fold.open : isActive(item.href);

  /** In the drawer: a quiet "better on desktop" mark beside pages not built for phones. */
  const desktopMark = (href: string) =>
    drawer && !isOpsMobileReady(href) ? (
      <Monitor className="h-3 w-3 shrink-0 opacity-40" aria-label="Lebih baik di desktop" />
    ) : null;

  function onGroupClick(item: NavItem) {
    // Already inside → just fold / unfold it. From outside → land on its first page.
    if (isActive(item.href)) {
      setFold({ path: pathname, label: item.label, open: !groupOpen(item) });
      return;
    }
    router.push(item.children![0].href);
  }

  // ── Width transition ──────────────────────────────────────────────────────

  return (
    <TooltipProvider delayDuration={120}>
      <aside
        className={cn(
          'flex flex-col bg-card transition-all duration-200 ease-in-out overflow-hidden',
          drawer ? 'h-full w-full' : 'h-screen border-r border-border',
          !drawer && (collapsed ? 'w-16' : 'w-64'),
        )}
      >
        {/* ── Logo / brand ── */}
        <div className="px-3 py-5 flex items-center gap-2 min-w-0">
          {collapsed ? (
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary">
              <span className="text-xs font-bold text-primary-foreground">OP</span>
            </div>
          ) : (
            <EmployeeLogoMark variant="color" className="w-32 shrink-0" />
          )}
          {!collapsed && (
            <div className="min-w-0 overflow-hidden">
              <p className="text-xs font-semibold text-foreground truncate">Ops Panel</p>
              {/* Signed-in name, like the Finance / Audit / IT sidebars. */}
              <p className="truncate text-[10px] text-muted-foreground">{session?.user?.name ?? storeName}</p>
            </div>
          )}
        </div>

        {/* ── Nav ── */}
        <nav className="flex-1 overflow-y-auto overflow-x-hidden px-2 py-4 space-y-5">

          {/* Overview section */}
          <div>
            {!collapsed && (
              <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Overview
              </p>
            )}
            <ul className="space-y-0.5">
              {NAV[0].items.map(({ href, label, icon: Icon, exact }) => {
                const active = isActive(href, exact);
                const linkCls = cn(
                  'flex items-center rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
                  collapsed ? 'justify-center' : 'gap-2.5',
                  active
                    ? 'bg-primary/10 text-primary'
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
                        {desktopMark(href)}
                        {active && <ChevronRight className="h-3 w-3 opacity-60" />}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Tasks section */}
          <div>
            {!collapsed && (
              <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Tasks
              </p>
            )}

            {/* Task Progress link */}
            <div className="mb-1">
              {collapsed ? (
                <NavTooltip label={TASK_PROGRESS_ITEM.label}>
                  <Link
                    href={TASK_PROGRESS_ITEM.href}
                    className={cn(
                      'flex items-center justify-center rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
                      isActive(TASK_PROGRESS_ITEM.href)
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                    )}
                  >
                    <TASK_PROGRESS_ITEM.icon className="h-4 w-4" />
                  </Link>
                </NavTooltip>
              ) : (
                <Link
                  href={TASK_PROGRESS_ITEM.href}
                  className={cn(
                    'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
                    isActive(TASK_PROGRESS_ITEM.href)
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                  )}
                >
                  <TASK_PROGRESS_ITEM.icon className="h-4 w-4 shrink-0" />
                  <span className="flex-1">{TASK_PROGRESS_ITEM.label}</span>
                  {desktopMark(TASK_PROGRESS_ITEM.href)}
                  {isActive(TASK_PROGRESS_ITEM.href) && <ChevronRight className="h-3 w-3 opacity-60" />}
                </Link>
              )}
            </div>
          </div>

          {/* People + Operations sections */}
          {restSections.map(({ section, items }) => (
            <div key={section}>
              {!collapsed && (
                <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  {section}
                </p>
              )}
              <ul className="space-y-0.5">
                {items.map((item) => {
                  const { href, label, icon: Icon, children } = item;
                  const active = isActive(href);
                  const linkCls = cn(
                    'flex items-center rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
                    collapsed ? 'justify-center' : 'gap-2.5',
                    active
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                  );

                  // ── Accordion group (Impact Visit ▸ Visits / Monthly Report, Petty Cash ▸ Requests / Refills) ──
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
                          {desktopMark(children[0].href)}
                          <ChevronDown className={cn('h-3.5 w-3.5 opacity-60 transition-transform', open && 'rotate-180')} />
                        </button>

                        {open && (
                          <ul className="ml-[1.15rem] mt-0.5 space-y-0.5 border-l border-border pl-2.5">
                            {children.map((child) => {
                              const on = activeChild(children) === child.href;
                              return (
                                <li key={child.href}>
                                  <Link
                                    href={child.href}
                                    aria-current={on ? 'page' : undefined}
                                    className={cn(
                                      'flex items-center rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors',
                                      on
                                        ? 'bg-primary/10 text-primary'
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
                        <NavTooltip label={label}>
                          <Link href={href} className={linkCls}>
                            <Icon className="h-4 w-4 shrink-0" />
                          </Link>
                        </NavTooltip>
                      ) : (
                        <Link href={href} className={linkCls}>
                          <Icon className="h-4 w-4 shrink-0" />
                          <span className="flex-1">{label}</span>
                          {desktopMark(href)}
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
              <NavTooltip label={`${session?.user?.name ?? 'Ops'} · Logout`}>
                <button
                  onClick={() => signOut({ callbackUrl: '/login' })}
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                >
                  {session?.user?.name?.charAt(0).toUpperCase() ?? 'O'}
                </button>
              </NavTooltip>
            ) : (
              <>
                <UserAvatar
                  src={session?.user?.image}
                  name={session?.user?.name ?? 'Ops'}
                  className="h-7 w-7 shrink-0"
                  fallbackClassName="text-xs"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-foreground">
                    {session?.user?.name ?? 'Ops'}
                  </p>
                  <p className="truncate text-[10px] text-muted-foreground">
                    {(session?.user as any)?.nik ? `NIK ${(session?.user as any).nik}` : 'Ops'}
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
