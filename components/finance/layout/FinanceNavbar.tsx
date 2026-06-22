'use client';
// components/finance/layout/FinanceNavbar.tsx
//
// Slim top bar for the Finance panel.
// Exact same structure as OpsNavbar — collapse toggle on the left,
// optional right slot for future notifications / user avatar.

import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  collapsed: boolean;
  onToggle: () => void;
  /** Optional: extra content rendered in the right slot. */
  right?: React.ReactNode;
  className?: string;
}

export default function FinanceNavbar({ collapsed, onToggle, right, className }: Props) {
  return (
    <header
      className={cn(
        'sticky top-0 z-20 flex h-16 items-center gap-2 border-b border-border bg-card/90 backdrop-blur px-3',
        className,
      )}
    >
      {/* Toggle button */}
      <button
        type="button"
        onClick={onToggle}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
      >
        {collapsed
          ? <PanelLeftOpen  className="h-4 w-4" />
          : <PanelLeftClose className="h-4 w-4" />
        }
      </button>

      {/* Divider */}
      <div className="h-5 w-px bg-border" />

      {/* Right slot */}
      <div className="flex flex-1 items-center justify-end gap-2">
        {right}
      </div>
    </header>
  );
}