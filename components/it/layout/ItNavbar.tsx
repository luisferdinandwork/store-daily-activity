'use client';
// components/it/layout/ItNavbar.tsx
//
// Slim top bar for the IT panel. Same structure/tokens as FinanceNavbar/OpsNavbar.

import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  collapsed: boolean;
  onToggle: () => void;
  right?: React.ReactNode;
  className?: string;
}

export default function ItNavbar({ collapsed, onToggle, right, className }: Props) {
  return (
    <header
      className={cn(
        'sticky top-0 z-20 flex h-16 items-center gap-2 border-b border-border bg-card/90 backdrop-blur px-3',
        className,
      )}
    >
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

      <div className="h-5 w-px bg-border" />

      <div className="flex flex-1 items-center justify-end gap-2">
        {right}
      </div>
    </header>
  );
}
