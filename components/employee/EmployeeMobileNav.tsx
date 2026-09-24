// components/employee/EmployeeMobileNav.tsx
'use client';

// Bottom tab bar of the employee app.
//   • Active tab: a soft pill grows in behind its icon; label turns primary.
//   • Scrolling down compacts the bar (labels fold away), scrolling up restores
//     it; while scrolling it turns more translucent.
//   • Swipe left/right across the bar to move between tabs.
// Its live height is published as --emp-nav-h so everything pinned above it
// (TaskSubmitBar, FloatingMenu) follows — see --emp-bottom in app/globals.css.

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type TouchEvent } from 'react';
import { Home, ListChecks, CalendarCheck2, CalendarDays, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

const NAV_ITEMS = [
  { href: '/employee',            label: 'Home',       Icon: Home           },
  { href: '/employee/tasks',      label: 'Tasks',      Icon: ListChecks     },
  { href: '/employee/attendance', label: 'Attendance', Icon: CalendarCheck2 },
  { href: '/employee/schedule',   label: 'Schedule',   Icon: CalendarDays   },
  { href: '/employee/issues',     label: 'Issues',     Icon: AlertTriangle  },
];

// ── Tuning knobs ────────────────────────────────────────────────────────────
const SCROLL_SHRINK_THRESHOLD = 24; // px scrolled before the bar is allowed to compact
const SCROLL_IDLE_DELAY = 180;      // ms after the last scroll event before it un-fades
const SWIPE_THRESHOLD = 40;         // px of horizontal drag needed to switch tabs

export default function EmployeeMobileNav() {
  const pathname = usePathname();
  const router = useRouter();

  const activeIndex = NAV_ITEMS.findIndex(({ href }) =>
    href === '/employee' ? pathname === href : pathname.startsWith(href),
  );

  // ── scroll-driven compact size + frosted translucency ────────────────────
  const [compact, setCompact] = useState(false);
  const [isScrolling, setIsScrolling] = useState(false);
  const lastScrollY = useRef(0);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ticking = useRef(false);

  useEffect(() => {
    lastScrollY.current = window.scrollY;

    const handleScroll = () => {
      if (ticking.current) return;
      ticking.current = true;

      requestAnimationFrame(() => {
        const y = window.scrollY;
        const goingDown = y > lastScrollY.current + 2;
        const goingUp = y < lastScrollY.current - 2;

        if (y <= SCROLL_SHRINK_THRESHOLD) setCompact(false);
        else if (goingDown) setCompact(true);
        else if (goingUp) setCompact(false);

        setIsScrolling(true);
        if (idleTimer.current) clearTimeout(idleTimer.current);
        idleTimer.current = setTimeout(() => setIsScrolling(false), SCROLL_IDLE_DELAY);

        lastScrollY.current = y;
        ticking.current = false;
      });
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  }, []);

  // Publish the live bar height (see file header).
  useEffect(() => {
    document.documentElement.style.setProperty('--emp-nav-h', compact ? '3.5rem' : '4rem');
  }, [compact]);

  useEffect(() => () => {
    document.documentElement.style.removeProperty('--emp-nav-h');
  }, []);

  // ── swipe across the bar to change tabs ───────────────────────────────────
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);

  const handleTouchStart = (e: TouchEvent) => {
    touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    swiped.current = false;
  };

  const handleTouchMove = (e: TouchEvent) => {
    if (!touchStart.current || swiped.current) return;
    const dx = e.touches[0].clientX - touchStart.current.x;
    const dy = e.touches[0].clientY - touchStart.current.y;
    if (Math.abs(dx) < SWIPE_THRESHOLD || Math.abs(dx) < Math.abs(dy)) return;

    const dir = dx < 0 ? 1 : -1; // swipe left → next tab, swipe right → previous tab
    const nextIndex = Math.min(NAV_ITEMS.length - 1, Math.max(0, activeIndex + dir));
    if (nextIndex !== activeIndex) {
      swiped.current = true;
      router.push(NAV_ITEMS[nextIndex].href);
    }
  };

  const handleTouchEnd = () => {
    touchStart.current = null;
  };

  return (
    <nav
      aria-label="Menu utama"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      className={cn(
        'fixed inset-x-0 bottom-0 z-50 border-t border-border/70',
        'shadow-[0_-8px_24px_-16px_rgba(30,27,75,0.25)] backdrop-blur-xl',
        'transition-[height,background-color] duration-300 ease-out',
        isScrolling ? 'bg-card/70' : 'bg-card/95',
      )}
      style={{ height: 'var(--emp-bottom)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <div className="mx-auto flex h-full max-w-md items-stretch px-1">
        {NAV_ITEMS.map(({ href, label, Icon }, i) => {
          const active = i === activeIndex;
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex min-w-0 flex-1 flex-col items-center justify-center gap-1 transition-colors active:scale-95',
                active ? 'text-primary' : 'text-muted-foreground',
              )}
            >
              <span className="relative flex h-8 w-14 items-center justify-center">
                {/* Active pill — grows out from the icon's centre */}
                <span
                  aria-hidden="true"
                  className={cn(
                    'absolute inset-0 rounded-full bg-primary/12 transition-all duration-300 ease-out',
                    active ? 'scale-100 opacity-100' : 'scale-50 opacity-0',
                  )}
                />
                <Icon className="relative h-[22px] w-[22px]" strokeWidth={active ? 2.3 : 1.8} />
              </span>
              <span
                className={cn(
                  'max-w-full truncate px-0.5 text-[11px] leading-none transition-all duration-300 ease-out',
                  active ? 'font-semibold' : 'font-medium',
                  compact ? 'max-h-0 opacity-0' : 'max-h-3 opacity-100',
                )}
              >
                {label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
