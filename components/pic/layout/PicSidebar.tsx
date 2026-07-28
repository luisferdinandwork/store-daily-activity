'use client';
// components/pic/layout/PicSidebar.tsx

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { ClipboardCheck, LogOut, Settings2, Smartphone, Store } from 'lucide-react';
import { cn } from '@/lib/utils';
import { setEmployeeViewCookie } from '@/lib/pic-view';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import EmployeeLogoMark from '@/components/employee/EmployeeLogoMark';

const NAV = [
  { href: '/pic', label: 'Manage Schedule', icon: Settings2, exact: true },
  { href: '/pic/tasks', label: 'Tasks', icon: ClipboardCheck },
];

interface Props {
  collapsed?: boolean;
}

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

const EMP_TYPE_LABEL: Record<string, string> = {
  pic_1: 'PIC 1',
  pic_2: 'PIC 2',
};

export default function PicSidebar({ collapsed = false }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = useSession();

  const employeeType = (session?.user as any)?.employeeType as string | undefined;
  const roleLabel = (employeeType && EMP_TYPE_LABEL[employeeType]) || 'PIC';

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname.startsWith(href);

  function switchToEmployeeView() {
    setEmployeeViewCookie();
    router.push('/employee');
  }

  return (
    <TooltipProvider delayDuration={120}>
      <aside
        className={cn(
          'flex h-screen flex-col border-r border-border bg-card transition-all duration-200 ease-in-out overflow-hidden',
          collapsed ? 'w-16' : 'w-64',
        )}
      >
        {/* Logo / brand */}
        <div className="px-3 py-5 flex items-center gap-2 min-w-0">
          {collapsed ? (
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary">
              <Store className="h-3.5 w-3.5 text-primary-foreground" />
            </div>
          ) : (
            <EmployeeLogoMark variant="color" className="w-32 shrink-0" />
          )}
          {!collapsed && (
            <div className="min-w-0 overflow-hidden">
              <p className="text-xs font-semibold text-foreground truncate">PIC Panel</p>
              <p className="truncate text-[10px] text-muted-foreground">{roleLabel}</p>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto overflow-x-hidden px-2 py-4 space-y-1">
          <ul className="space-y-0.5">
            {NAV.map(({ href, label, icon: Icon, exact }) => {
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
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Switch to employee (mobile) view — to do their own tasks */}
        <div className="border-t border-border px-2 py-3">
          {collapsed ? (
            <NavTooltip label="Do My Tasks (Employee View)">
              <button
                type="button"
                onClick={() => switchToEmployeeView()}
                className="flex h-9 w-full items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <Smartphone className="h-4 w-4" />
              </button>
            </NavTooltip>
          ) : (
            <button
              type="button"
              onClick={() => switchToEmployeeView()}
              className="flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <Smartphone className="h-4 w-4 shrink-0" />
              <span className="flex-1 text-left">Do My Tasks</span>
            </button>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-border px-2 py-3">
          <div className={cn('flex items-center rounded-md px-2 py-2', collapsed ? 'justify-center' : 'gap-2.5')}>
            {collapsed ? (
              <NavTooltip label={`${session?.user?.name ?? 'PIC'} · Logout`}>
                <button
                  onClick={() => signOut({ callbackUrl: '/login' })}
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                >
                  {session?.user?.name?.charAt(0).toUpperCase() ?? 'P'}
                </button>
              </NavTooltip>
            ) : (
              <>
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground">
                  {session?.user?.name?.charAt(0).toUpperCase() ?? 'P'}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-foreground">
                    {session?.user?.name ?? 'PIC'}
                  </p>
                  <p className="truncate text-[10px] text-muted-foreground">
                    {(session?.user as any)?.nik ? `NIK ${(session?.user as any).nik}` : roleLabel}
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
