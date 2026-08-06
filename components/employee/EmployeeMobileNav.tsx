// components/employee/EmployeeMobileNav.tsx
'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type TouchEvent,
} from 'react';
import { Home, CheckSquare, CalendarDays, LayoutGrid, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

const NAV_ITEMS = [
  { href: '/employee',            label: 'Home',       Icon: Home         },
  { href: '/employee/tasks',      label: 'Tasks',      Icon: CheckSquare  },
  { href: '/employee/attendance', label: 'Attendance', Icon: CalendarDays },
  { href: '/employee/schedule',   label: 'Schedule',   Icon: LayoutGrid   },
  { href: '/employee/issues',     label: 'Issues',     Icon: AlertTriangle },
];

// ── Tuning knobs ────────────────────────────────────────────────────────────
const SCROLL_SHRINK_THRESHOLD = 24; // px scrolled before the bar is allowed to compact
const SCROLL_IDLE_DELAY = 180;      // ms after the last scroll event before it un-fades
const SWIPE_THRESHOLD = 40;         // px of horizontal drag needed to switch tabs

export default function EmployeeMobileNav() {
  const pathname = usePathname();
  const router = useRouter();

  const navItems = NAV_ITEMS;

  const activeIndex = navItems.findIndex(({ href }) =>
    href === '/employee' ? pathname === href : pathname.startsWith(href),
  );

  // ── 1 & 2: scroll-driven compact size + frosted translucency ─────────────
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

  // ── 3: sliding active-tab pill ────────────────────────────────────────────
  const itemRefs = useRef<Array<HTMLAnchorElement | null>>([]);
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });
  const [indicatorReady, setIndicatorReady] = useState(false);

  const measureIndicator = useCallback(() => {
    const el = itemRefs.current[activeIndex];
    if (!el) return;
    setIndicator({ left: el.offsetLeft, width: el.offsetWidth });
    setIndicatorReady(true);
  }, [activeIndex]);

  useLayoutEffect(() => {
    measureIndicator();
  }, [measureIndicator, compact, navItems.length]);

  useEffect(() => {
    window.addEventListener('resize', measureIndicator);
    return () => window.removeEventListener('resize', measureIndicator);
  }, [measureIndicator]);

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
    const nextIndex = Math.min(navItems.length - 1, Math.max(0, activeIndex + dir));
    if (nextIndex !== activeIndex) {
      swiped.current = true;
      router.push(navItems[nextIndex].href);
    }
  };

  const handleTouchEnd = () => {
    touchStart.current = null;
  };

  return (
    <nav
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      className={cn(
        'fixed bottom-0 left-0 right-0 z-50 flex items-stretch border-t border-border/60 md:hidden',
        'backdrop-blur-xl transition-all duration-300 ease-out',
        compact ? 'h-14' : 'h-16',
        isScrolling ? 'bg-card/60' : 'bg-card/95',
      )}
    >
      {/* Sliding active-tab indicator */}
      <span
        className={cn(
          'pointer-events-none absolute top-1.5 bottom-1.5 rounded-2xl bg-primary/10',
          'transition-[left,width,opacity] duration-300 ease-[cubic-bezier(0.34,1.3,0.64,1)]',
          indicatorReady ? 'opacity-100' : 'opacity-0',
        )}
        style={{ left: indicator.left, width: indicator.width }}
      />

      {navItems.map(({ href, label, Icon }, i) => {
        const active = i === activeIndex;
        return (
          <Link
            key={href}
            href={href}
            ref={(el) => { itemRefs.current[i] = el; }}
            className={cn(
              'relative z-10 flex flex-1 flex-col items-center justify-center gap-1 text-[10px] font-semibold uppercase tracking-widest transition-colors',
              active ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon
              className={cn(
                'transition-all duration-300 ease-out',
                compact ? 'h-[18px] w-[18px]' : 'h-5 w-5',
              )}
              strokeWidth={active ? 2.5 : 1.75}
            />
            <span
              className={cn(
                'overflow-hidden transition-all duration-300 ease-out',
                compact ? 'max-h-0 scale-90 opacity-0' : 'max-h-3 scale-100 opacity-100',
              )}
            >
              {label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
