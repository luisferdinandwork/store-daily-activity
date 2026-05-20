'use client';
// components/ops/OpsSidebar.tsx
//
// Main change:
// - Added /ops/users to People section.
// - Footer now displays NIK instead of email.

import { useEffect, useMemo, useState } from 'react';
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

const TASK_PROGRESS_ITEM = {
  href: '/ops/tasks/progress',
  label: 'Task Progress',
  icon: BarChart3,
  key: 'progress',
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
      { href: '/ops/users',      label: 'Users',      icon: UsersRound },
      { href: '/ops/schedules',  label: 'Schedules',  icon: Calendar },
      { href: '/ops/attendance', label: 'Attendance', icon: UserCheck },
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

interface Props {
  storeName?: string;
}

export default function OpsSidebar({ storeName = 'Store Manager' }: Props) {
  const pathname = usePathname();
  const { data: session } = useSession();

  const isOnTaskPage = pathname.startsWith('/ops/tasks') && pathname !== TASK_PROGRESS_ITEM.href;
  const [tasksOpen, setTasksOpen] = useState(isOnTaskPage);
  const [pendingCounts, setPendingCounts] = useState<Record<string, number>>({});

  const activeTaskLabel = useMemo(() => {
    return TASK_ITEMS.find((item) => pathname.startsWith(item.href))?.label ?? 'Task Monitor';
  }, [pathname]);

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname.startsWith(href);

  const taskSectionActive =
    pathname.startsWith('/ops/tasks') && !isActive(TASK_PROGRESS_ITEM.href);

  useEffect(() => {
    let intervalId: NodeJS.Timeout;

    async function fetchCounts() {
      try {
        const todayKey = new Date().toISOString().split('T')[0];
        const res = await fetch(`/api/ops/tasks/pending-counts?date=${todayKey}`, {
          cache: 'no-store',
        });

        if (res.ok) {
          const data = await res.json();
          setPendingCounts(data.counts || {});
        }
      } catch {
        console.error('Failed to fetch task pending counts');
      }
    }

    fetchCounts();
    intervalId = setInterval(fetchCounts, 5 * 60 * 1000);

    return () => clearInterval(intervalId);
  }, []);

  return (
    <aside className="flex h-screen w-64 flex-col border-r border-border bg-card">
      <div className="border-b border-border px-5 py-4">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary">
            <span className="text-xs font-bold text-primary-foreground">OP</span>
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-foreground">OPS Panel</p>
            <p className="truncate text-[10px] text-muted-foreground">{storeName}</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <div className="mb-5">
          <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Overview
          </p>
          <ul className="space-y-0.5">
            {NAV[0].items.map(({ href, label, icon: Icon, exact }) => {
              const active = isActive(href, exact);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    className={cn(
                      'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
                      active
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                    )}
                  >
                    <Icon className="h-4 w-4 flex-shrink-0" />
                    <span className="flex-1">{label}</span>
                    {active && <ChevronRight className="h-3 w-3 opacity-60" />}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="mb-5">
          <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Tasks
          </p>

          <div className="mb-1">
            <Link
              href={TASK_PROGRESS_ITEM.href}
              className={cn(
                'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
                isActive(TASK_PROGRESS_ITEM.href)
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
              )}
            >
              <TASK_PROGRESS_ITEM.icon className="h-4 w-4 flex-shrink-0" />
              <span className="flex-1">{TASK_PROGRESS_ITEM.label}</span>
              {isActive(TASK_PROGRESS_ITEM.href) ? <ChevronRight className="h-3 w-3 opacity-60" /> : null}
            </Link>
          </div>

          <div className="mx-2.5 my-1.5 border-t border-border/50" />

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
            <ClipboardCheck className="h-4 w-4 flex-shrink-0" />
            <span className="min-w-0 flex-1 truncate">
              {taskSectionActive ? activeTaskLabel : 'Task Monitor'}
            </span>
            <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', tasksOpen && 'rotate-180')} />
          </button>

          {tasksOpen && (
            <ul className="ml-3 mt-1 space-y-0.5 border-l border-border/70 pl-2">
              {TASK_ITEMS.map(({ href, label, icon: Icon, key }) => {
                const active = isActive(href);
                const count = pendingCounts[key] || 0;

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
                      <Icon className="h-3.5 w-3.5 flex-shrink-0" />
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
        </div>

        {NAV.slice(1).map(({ section, items }) => (
          <div key={section} className="mb-5">
            <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              {section}
            </p>
            <ul className="space-y-0.5">
              {items.map(({ href, label, icon: Icon, exact }) => {
                const active = isActive(href, exact);

                return (
                  <li key={href}>
                    <Link
                      href={href}
                      className={cn(
                        'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
                        active
                          ? 'bg-primary/10 text-primary'
                          : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                      )}
                    >
                      <Icon className="h-4 w-4 flex-shrink-0" />
                      <span className="flex-1">{label}</span>
                      {active && <ChevronRight className="h-3 w-3 opacity-60" />}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-border px-3 py-3">
        <div className="flex items-center gap-2.5 rounded-md px-2.5 py-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground">
            {session?.user?.name?.charAt(0).toUpperCase() ?? 'O'}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-foreground">
              {session?.user?.name ?? 'OPS Manager'}
            </p>
            <p className="truncate text-[10px] text-muted-foreground">
              {session?.user?.nik ? `NIK ${session.user.nik}` : 'OPS user'}
            </p>
          </div>
          <button
            onClick={() => signOut({ callbackUrl: '/login' })}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            title="Log out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
