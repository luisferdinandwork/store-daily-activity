// components/ops/OpsSidebar.tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  ListTodo,
  PlusCircle,
  Calendar,
  ClipboardCheck,
  Store,
  ChevronRight,
  LogOut,
  AlertTriangle,
} from 'lucide-react';

const NAV = [
  {
    section: 'Overview',
    items: [
      { href: '/ops',        label: 'Dashboard', icon: LayoutDashboard, exact: true },
      { href: '/ops/stores', label: 'Stores',    icon: Store },
    ],
  },
  {
    section: 'Tasks',
    items: [
      { href: '/ops/tasks',     label: 'Task Library', icon: ListTodo   },
      { href: '/ops/tasks/new', label: 'Create Task',  icon: PlusCircle },
    ],
  },
  {
    section: 'People',
    items: [
      { href: '/ops/schedules',  label: 'Schedules',  icon: Calendar      },
      { href: '/ops/attendance', label: 'Attendance', icon: ClipboardCheck },
    ],
  },
  {
    section: 'Operations',
    items: [
      { href: '/ops/issues', label: 'Issues', icon: AlertTriangle },
    ],
  },
];

interface Props {
  storeName?: string;
}

export default function OpsSidebar({ storeName = 'Store Manager' }: Props) {
  const pathname = usePathname();
  const { data: session } = useSession();

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname.startsWith(href);

  return (
    <aside className="flex h-screen w-56 flex-col border-r border-border bg-card">
      {/* Logo */}
      <div className="border-b border-border px-5 py-4">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary">
            <span className="text-xs font-bold text-primary-foreground">OP</span>
          </div>
          <div>
            <p className="text-xs font-semibold text-foreground">OPS Panel</p>
            <p className="truncate text-[10px] text-muted-foreground">{storeName}</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {NAV.map(({ section, items }) => (
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

      {/* Footer */}
      <div className="border-t border-border px-3 py-3">
        <div className="flex items-center gap-2.5 rounded-md px-2.5 py-2">
          <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground">
            {session?.user?.name?.charAt(0).toUpperCase() ?? 'O'}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-foreground">
              {session?.user?.name ?? 'OPS Manager'}
            </p>
            <p className="truncate text-[10px] text-muted-foreground">
              {session?.user?.email ?? 'ops@store.com'}
            </p>
          </div>

          <button
            onClick={() => signOut({ callbackUrl: '/login' })}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
            title="Log out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}