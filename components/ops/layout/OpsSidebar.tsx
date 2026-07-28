'use client';
// components/ops/layout/OpsSidebar.tsx

import { useMemo } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import {
  AlertTriangle,
  BarChart3,
  BookOpen,
  Calendar,
  ChevronRight,
  ClipboardCheck,
  FileCheck2,
  KeyRound,
  Layers,
  LayoutDashboard,
  LogOut,
  MapPinned,
  Store,
  Target,
  UserCheck,
  Wallet,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import EmployeeLogoMark from '@/components/employee/EmployeeLogoMark';

// ─── Nav data ─────────────────────────────────────────────────────────────────

const TASK_PROGRESS_ITEM = {
  href: '/ops/tasks/progress',
  label: 'Task Progress',
  icon: BarChart3,
  key: 'progress',
};

// Per task type: does it require location? — replaces the old per-store
// task monitoring pages entirely.
const TASK_SETTINGS_ITEM = {
  href: '/ops/tasks/settings',
  label: 'Task Management',
  icon: ClipboardCheck,
  key: 'task-settings',
};

// Shift ↔ task configuration. Sits below Task Management.
const SHIFT_TASKS_ITEM = {
  href: '/ops/shift-tasks',
  label: 'Shift & Tasks',
  icon: Layers,
  key: 'shift-tasks',
};

// New: employee performance target management. HO Ops sees all areas/stores,
// Area Ops is scoped to their assigned area (resolved server-side).
const PERFORMANCE_TARGETS_ITEM = {
  href: '/ops/performance-targets',
  label: 'Performance Targets',
  icon: Target,
  key: 'performance-targets',
};

// New: Business Central API credentials management (Settings group).
const BC_CREDENTIALS_ITEM = {
  href: '/ops/settings/bc-credentials',
  label: 'BC Credentials',
  icon: KeyRound,
  key: 'bc-credentials',
};

// OPS HO only — assign the one OPS Area user per area, rename areas, move
// stores between areas, and monitor task/attendance rolled up per area.
const AREA_MANAGEMENT_ITEM = {
  href: '/ops/areas',
  label: 'Area Management',
  icon: MapPinned,
  key: 'area-management',
};

// Digitized store-visit audit (paper "OPS Impact Visit" form). Both
// ops_area (own area) and ops_ho (all areas) can fill/view — area scoping
// is enforced server-side, not by hiding this nav item.
const IMPACT_VISIT_ITEM = {
  href: '/ops/impact-visits',
  label: 'Impact Visit',
  icon: FileCheck2,
  key: 'impact-visit',
};

// OPS HO only — manage the Knowledge Manual library employees see.
const MANUALS_ITEM = {
  href: '/ops/manuals',
  label: 'Knowledge Manual',
  icon: BookOpen,
  key: 'manuals',
};

const NAV = [
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
      { href: '/ops/manage',     label: 'Manage',     icon: ClipboardCheck },
    ],
  },
  {
    section: 'Operations',
    items: [
      { href: '/ops/issues',               label: 'Issues',               icon: AlertTriangle },
      { href: IMPACT_VISIT_ITEM.href,      label: IMPACT_VISIT_ITEM.label, icon: IMPACT_VISIT_ITEM.icon },
      { href: '/ops/petty-cash',           label: 'Petty Cash',           icon: Wallet },
      { href: PERFORMANCE_TARGETS_ITEM.href, label: PERFORMANCE_TARGETS_ITEM.label, icon: PERFORMANCE_TARGETS_ITEM.icon },
    ],
  },
  {
    section: 'Settings',
    items: [
      { href: BC_CREDENTIALS_ITEM.href, label: BC_CREDENTIALS_ITEM.label, icon: BC_CREDENTIALS_ITEM.icon },
    ],
  },
];

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  storeName?: string;
  /** Controlled collapse state from OpsNavbar. If omitted the sidebar manages itself. */
  collapsed?: boolean;
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

export default function OpsSidebar({ storeName = 'Store Manager', collapsed = false }: Props) {
  const pathname   = usePathname();
  const { data: session } = useSession();

  const isOpsHo = session?.user?.isOpsHo === true;
  const isIt    = session?.user?.role === 'it';

  // NAV[0] (Overview) renders separately below; the rest — People, Operations,
  // Settings — render via this array, with an OPS-HO-only "OPS HQ" section
  // spliced in right after Overview. The "Settings" section (BC Credentials)
  // is IT-only, so it's filtered out for everyone else.
  const restSections = useMemo(() => {
    const base = isOpsHo
      ? [{ section: 'OPS HQ', items: [AREA_MANAGEMENT_ITEM, MANUALS_ITEM] }, ...NAV.slice(1)]
      : NAV.slice(1);

    return isIt ? base : base.filter((s) => s.section !== 'Settings');
  }, [isOpsHo, isIt]);

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname.startsWith(href);

  // ── Width transition ──────────────────────────────────────────────────────

  return (
    <TooltipProvider delayDuration={120}>
      <aside
        className={cn(
          'flex h-screen flex-col border-r border-border bg-card transition-all duration-200 ease-in-out overflow-hidden',
          collapsed ? 'w-16' : 'w-64',
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
              <p className="text-xs font-semibold text-foreground truncate">OPS Panel</p>
              <p className="truncate text-[10px] text-muted-foreground">{storeName}</p>
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
                  {isActive(TASK_PROGRESS_ITEM.href) && <ChevronRight className="h-3 w-3 opacity-60" />}
                </Link>
              )}
            </div>

            {/* Task Management + Shift & Tasks — IT-only config */}
            {isIt && (
              <>
                {!collapsed && <div className="mx-2.5 my-1.5 border-t border-border/50" />}

                {/* Task Management — per task type: does it require location? */}
                {collapsed ? (
                  <NavTooltip label={TASK_SETTINGS_ITEM.label}>
                    <Link
                      href={TASK_SETTINGS_ITEM.href}
                      className={cn(
                        'flex items-center justify-center rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
                        isActive(TASK_SETTINGS_ITEM.href)
                          ? 'bg-primary/10 text-primary'
                          : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                      )}
                    >
                      <TASK_SETTINGS_ITEM.icon className="h-4 w-4" />
                    </Link>
                  </NavTooltip>
                ) : (
                  <Link
                    href={TASK_SETTINGS_ITEM.href}
                    className={cn(
                      'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
                      isActive(TASK_SETTINGS_ITEM.href)
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                    )}
                  >
                    <TASK_SETTINGS_ITEM.icon className="h-4 w-4 shrink-0" />
                    <span className="flex-1">{TASK_SETTINGS_ITEM.label}</span>
                    {isActive(TASK_SETTINGS_ITEM.href) && <ChevronRight className="h-3 w-3 opacity-60" />}
                  </Link>
                )}

                {/* Shift & Tasks config — sits below Task Management */}
                <div className="mt-1">
                  {collapsed ? (
                    <NavTooltip label={SHIFT_TASKS_ITEM.label}>
                      <Link
                        href={SHIFT_TASKS_ITEM.href}
                        className={cn(
                          'flex items-center justify-center rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
                          isActive(SHIFT_TASKS_ITEM.href)
                            ? 'bg-primary/10 text-primary'
                            : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                        )}
                      >
                        <SHIFT_TASKS_ITEM.icon className="h-4 w-4" />
                      </Link>
                    </NavTooltip>
                  ) : (
                    <Link
                      href={SHIFT_TASKS_ITEM.href}
                      className={cn(
                        'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
                        isActive(SHIFT_TASKS_ITEM.href)
                          ? 'bg-primary/10 text-primary'
                          : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                      )}
                    >
                      <SHIFT_TASKS_ITEM.icon className="h-4 w-4 shrink-0" />
                      <span className="flex-1">{SHIFT_TASKS_ITEM.label}</span>
                      {isActive(SHIFT_TASKS_ITEM.href) && <ChevronRight className="h-3 w-3 opacity-60" />}
                    </Link>
                  )}
                </div>
              </>
            )}
          </div>

          {/* People + Operations + Settings sections */}
          {restSections.map(({ section, items }) => (
            <div key={section}>
              {!collapsed && (
                <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  {section}
                </p>
              )}
              <ul className="space-y-0.5">
                {items.map(({ href, label, icon: Icon }) => {
                  const active = isActive(href);
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
              <NavTooltip label={`${session?.user?.name ?? 'OPS Manager'} · Logout`}>
                <button
                  onClick={() => signOut({ callbackUrl: '/login' })}
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                >
                  {session?.user?.name?.charAt(0).toUpperCase() ?? 'O'}
                </button>
              </NavTooltip>
            ) : (
              <>
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground">
                  {session?.user?.name?.charAt(0).toUpperCase() ?? 'O'}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-foreground">
                    {session?.user?.name ?? 'OPS Manager'}
                  </p>
                  <p className="truncate text-[10px] text-muted-foreground">
                    {(session?.user as any)?.nik ? `NIK ${(session?.user as any).nik}` : 'OPS user'}
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