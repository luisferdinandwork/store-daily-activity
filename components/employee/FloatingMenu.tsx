// components/employee/FloatingMenu.tsx
'use client';

import { useState, useRef, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import {
  Menu,
  X,
  MessageSquare,
  HelpCircle,
  Settings,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Menu Configuration (Easy to add more later) ──────────────────────────────

interface MenuItem {
  label: string;
  href: string;
  icon: React.ElementType;
  color?: string; // Tailwind text color class
}

const MORE_MENU_ITEMS: MenuItem[] = [
  { label: 'Issues & Reports', href: '/employee/issues', icon: MessageSquare, color: 'text-blue-500' },
  { label: 'Help & FAQ',       href: '/employee/help',    icon: HelpCircle,    color: 'text-emerald-500' },
  { label: 'Settings',         href: '/employee/settings', icon: Settings,      color: 'text-muted-foreground' },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function FloatingMenu() {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu automatically when navigating to a new page
  useEffect(() => {
    setIsOpen(false);
  }, [pathname]);

  // Prevent body scroll when menu is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  return (
    <>
      {/* ── Floating Action Button (FAB) ── */}
      <button
        onClick={() => setIsOpen(true)}
        className={cn(
          'fixed right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full shadow-lg transition-all active:scale-95 md:hidden',
          'bg-primary text-primary-foreground hover:bg-primary/90'
        )}
        style={{ bottom: '5.5rem' }} // Positioned safely above the bottom nav
        aria-label="Open more menu"
      >
        <Menu className="h-6 w-6" />
      </button>

      {/* ── Overlay & Slide-up Menu ── */}
      {isOpen && (
        <>
          {/* Transparent Black Overlay */}
          <div 
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm transition-opacity md:hidden"
            onClick={() => setIsOpen(false)}
          />

          {/* Menu Container */}
          <div 
            ref={menuRef}
            className="fixed inset-x-0 bottom-0 z-50 transform transition-transform duration-300 ease-out md:hidden"
          >
            <div className="mx-4 mb-20 overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
              {/* Header */}
              <div className="flex items-center justify-between border-b border-border px-5 py-4">
                <h2 className="text-base font-bold text-foreground">More</h2>
                <button 
                  onClick={() => setIsOpen(false)} 
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Menu Links */}
              <div className="p-2">
                {MORE_MENU_ITEMS.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="flex items-center gap-3 rounded-xl px-4 py-3.5 text-foreground transition-colors hover:bg-secondary active:scale-[0.98]"
                    >
                      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-secondary">
                        <Icon className={cn('h-4.5 w-4.5', item.color ?? 'text-muted-foreground')} />
                      </div>
                      <span className="flex-1 text-sm font-medium">{item.label}</span>
                      <ChevronRight className="h-4 w-4 text-muted-foreground/50" />
                    </Link>
                  );
                })}
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}