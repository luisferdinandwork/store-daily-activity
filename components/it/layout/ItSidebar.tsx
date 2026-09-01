'use client';
// components/it/layout/ItSidebar.tsx
//
// Collapsible sidebar for the IT (super-admin) panel. Same structural
// pattern as FinanceSidebar/AuditSidebar, cyan-accented (IT's brand color).
//
//   Overview
//     Dashboard            /it
//     Switch Role          /it/switch-role      (preview the app as another role)
//
//   Management
//     Users                 /it/users            (create/edit accounts, assign roles)
//
//   Configuration (IT-only)
//     Task Management        /it/task-management
//     Shift & Tasks           /it/shift-tasks
//     BC Credentials           /it/bc-credentials
//     Performance Target Defaults /it/target-allocation (PIC1/PIC2/SA % grid)
//
//   Other Panels (IT keeps its role — a "Back to IT" banner shows on the way)
//     Ops Panel             /ops
//     Finance Panel         /finance
//     Audit Panel           /audit
//
//   Issues (every role's queue — IT can view all)
//     IT Issues              /it/issues
//     Ops Issues            /ops/issues
//     Finance Issues        /finance/issues
//     Audit Issues           /audit/issues

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import {
  AlertTriangle,
  ChevronRight,
  ClipboardCheck,
  KeyRound,
  Layers,
  LayoutDashboard,
  LogOut,
  Percent,
  Repeat,
  Store,
  Users,
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
      { href: '/it', label: 'Dashboard', icon: LayoutDashboard, exact: true },
      { href: '/it/switch-role', label: 'Switch Role', icon: Repeat },
    ],
  },
  {
    section: 'Management',
    items: [
      { href: '/it/users', label: 'Users', icon: Users },
    ],
  },
  {
    section: 'Configuration',
    items: [
      { href: '/it/task-management', label: 'Task Management', icon: ClipboardCheck },
      { href: '/it/shift-tasks', label: 'Shift & Tasks', icon: Layers },
      { href: '/it/bc-credentials', label: 'BC Credentials', icon: KeyRound },
      { href: '/it/target-allocation', label: 'Performance Target Defaults', icon: Percent },
    ],
  },
  {
    section: 'Other Panels',
    items: [
      { href: '/ops', label: 'Ops Panel', icon: Store },
      { href: '/finance', label: 'Finance Panel', icon: Wallet },
      { href: '/audit', label: 'Audit Panel', icon: ClipboardCheck },
    ],
  },
  {
    section: 'Issues',
    items: [
      { href: '/it/issues', label: 'IT Issues', icon: AlertTriangle },
      { href: '/ops/issues', label: 'Ops Issues', icon: AlertTriangle },
      { href: '/finance/issues', label: 'Finance Issues', icon: AlertTriangle },
      { href: '/audit/issues', label: 'Audit Issues', icon: AlertTriangle },
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

export default function ItSidebar({ collapsed = false, userName = 'IT' }: Props) {
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
                      ? 'bg-cyan-600/10 text-cyan-700'
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
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-cyan-50 text-xs font-semibold text-cyan-700 hover:bg-red-50 hover:text-red-600 transition-colors"
                >
                  {initial}
                </button>
              </NavTooltip>
            ) : (
              <>
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-cyan-50 text-xs font-semibold text-cyan-700">
                  {initial}
                </div>
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
