// components/employee/EmployeeMobileNav.tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Home, CheckSquare, CalendarDays, UserCircle, LayoutGrid, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

const BASE_NAV = [
  { href: '/employee',            label: 'Home',       Icon: Home         },
  { href: '/employee/tasks',      label: 'Tasks',      Icon: CheckSquare  },
  { href: '/employee/attendance', label: 'Attendance', Icon: CalendarDays },
  { href: '/employee/issues',     label: 'Issues',     Icon: AlertTriangle },
  { href: '/employee/profile',    label: 'Profile',    Icon: UserCircle   },
];

const PIC1_NAV_ITEM = {
  href:  '/employee/schedule',
  label: 'Schedule',
  Icon:  LayoutGrid,
};

export default function EmployeeMobileNav() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const employeeType = (session?.user as any)?.employeeType as string | null;

  // PIC 1 gets an extra "Schedule" tab inserted before Issues
  const navItems = employeeType === 'pic_1'
    ? [
        BASE_NAV[0],                        // Home
        BASE_NAV[1],                        // Tasks
        BASE_NAV[2],                        // Attendance
        PIC1_NAV_ITEM,                      // Schedule (PIC 1 only)
        BASE_NAV[3],                        // Issues
        BASE_NAV[4],                        // Profile
      ]
    : BASE_NAV;

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 flex h-16 items-stretch border-t border-border bg-card md:hidden">
      {navItems.map(({ href, label, Icon }) => {
        const active =
          href === '/employee' ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex flex-1 flex-col items-center justify-center gap-1 text-[10px] font-semibold uppercase tracking-widest transition-colors',
              active ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <span
              className={cn(
                'mb-0.5 h-1 w-1 rounded-full transition-opacity',
                active ? 'bg-primary opacity-100' : 'opacity-0',
              )}
            />
            <Icon
              className={cn('h-5 w-5', active ? 'text-primary' : 'text-muted-foreground')}
              strokeWidth={active ? 2.5 : 1.75}
            />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}