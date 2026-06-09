'use client';
// components/ops/layout/OpsSidebar.tsx
//
// Changes from original:
// - Accepts `collapsed` + `onToggle` props from OpsNavbar (or can self-manage).
// - When collapsed: renders icon-only rail (w-16) with Tooltip on each item.
// - When expanded: full w-64 layout (unchanged look from original).
// - Tooltip uses shadcn Tooltip primitives.
// - Added "Shift & Tasks" config link directly below the Task Management accordion.

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import {
  AlertTriangle,
  BarChart3,
  Calendar,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  DoorClosed,
  FileText,
  Layers,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Megaphone,
  MonitorCheck,
  PackageCheck,
  ReceiptText,
  Shirt,
  Store,
  UserCheck,
  UsersRound,
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

// ─── Nav data ─────────────────────────────────────────────────────────────────

const TASK_PROGRESS_ITEM = {
  href: '/ops/tasks/progress',
  label: 'Task Progress',
  icon: BarChart3,
  key: 'progress',
};

// New: shift ↔ task configuration. Sits below the Task Management accordion.
const SHIFT_TASKS_ITEM = {
  href: '/ops/shift-tasks',
  label: 'Shift & Tasks',
  icon: Layers,
  key: 'shift-tasks',
};

const TASK_ITEMS = [
  { href: '/ops/tasks/store-front',        label: 'Store Front',        icon: Store,         key: 'store-front' },
  { href: '/ops/tasks/store-opening',      label: 'Store Opening',      icon: DoorClosed,    key: 'store-opening' },
  { href: '/ops/tasks/setoran',            label: 'Setoran',            icon: WalletCards,   key: 'setoran' },
  { href: '/ops/tasks/cek-bin',            label: 'Cek Bin',            icon: PackageCheck,  key: 'cek-bin' },
  { href: '/ops/tasks/vm-checklist',       label: 'VM Checklist',       icon: MonitorCheck,  key: 'vm-checklist' },
  { href: '/ops/tasks/marketing-check',    label: 'Marketing Check',    icon: Megaphone,     key: 'marketing-check' },
  { href: '/ops/tasks/item-dropping',      label: 'Item Dropping',      icon: PackageCheck,  key: 'item-dropping' },
  { href: '/ops/tasks/briefing',           label: 'Briefing',           icon: UsersRound,    key: 'briefing' },
  { href: '/ops/tasks/edc-reconciliation', label: 'EDC Reconciliation', icon: ReceiptText,   key: 'edc-reconciliation' },
  { href: '/ops/tasks/eod-z-report',       label: 'EOD Z Report',       icon: FileText,      key: 'eod-z-report' },
  { href: '/ops/tasks/open-statement',     label: 'Open Statement',     icon: ListChecks,    key: 'open-statement' },
  { href: '/ops/tasks/grooming',           label: 'Grooming',           icon: Shirt,         key: 'grooming' },
];

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
      { href: '/ops/issues',     label: 'Issues',     icon: AlertTriangle },
      { href: '/ops/petty-cash', label: 'Petty Cash', icon: Wallet },
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

  const isOnTaskPage   = pathname.startsWith('/ops/tasks') && pathname !== TASK_PROGRESS_ITEM.href;
  const [tasksOpen, setTasksOpen] = useState(isOnTaskPage);
  const [pendingCounts] = useState<Record<string, number>>({});

  const activeTaskLabel = useMemo(
    () => TASK_ITEMS.find((item) => pathname.startsWith(item.href))?.label ?? 'Task Management',
    [pathname],
  );

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname.startsWith(href);

  const taskSectionActive =
    pathname.startsWith('/ops/tasks') && !isActive(TASK_PROGRESS_ITEM.href);

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
        <div className="px-3 py-4 flex items-center gap-2 min-w-0">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary">
            <span className="text-xs font-bold text-primary-foreground">OP</span>
          </div>
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

            {!collapsed && <div className="mx-2.5 my-1.5 border-t border-border/50" />}

            {/* Task Monitor accordion */}
            {collapsed ? (
              <NavTooltip label={taskSectionActive ? activeTaskLabel : 'Task Management'}>
                <button
                  type="button"
                  onClick={() => setTasksOpen((v) => !v)}
                  className={cn(
                    'flex w-full items-center justify-center rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
                    taskSectionActive
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                  )}
                >
                  <ClipboardCheck className="h-4 w-4" />
                </button>
              </NavTooltip>
            ) : (
              <button
                type="button"
                onClick={() => setTasksOpen((v) => !v)}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm font-medium transition-colors',
                  taskSectionActive
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                )}
              >
                <ClipboardCheck className="h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">
                  {taskSectionActive ? activeTaskLabel : 'Task Management'}
                </span>
                <ChevronDown
                  className={cn('h-3.5 w-3.5 transition-transform', tasksOpen && 'rotate-180')}
                />
              </button>
            )}

            {/* Sub-items: only show when expanded */}
            {!collapsed && tasksOpen && (
              <ul className="ml-3 mt-1 space-y-0.5 border-l border-border/70 pl-2">
                {TASK_ITEMS.map(({ href, label, icon: Icon, key }) => {
                  const active = isActive(href);
                  const count  = pendingCounts[key] || 0;
                  return (
                    <li key={href}>
                      <Link
                        href={href}
                        className={cn(
                          'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
                          active
                            ? 'bg-primary/10 text-primary'
                            : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                        )}
                      >
                        <Icon className="h-3.5 w-3.5 shrink-0" />
                        <span className="min-w-0 flex-1 truncate">{label}</span>
                        {count > 0 && (
                          <span
                            className={cn(
                              'flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-bold leading-none',
                              active ? 'bg-primary/20 text-primary' : 'bg-red-500 text-white',
                            )}
                          >
                            {count > 99 ? '99+' : count}
                          </span>
                        )}
                        {active && !count && <ChevronRight className="h-3 w-3 opacity-60" />}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}

            {/* ── NEW: Shift & Tasks config — sits below Task Management ── */}
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
          </div>

          {/* People + Operations sections */}
          {NAV.slice(1).map(({ section, items }) => (
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