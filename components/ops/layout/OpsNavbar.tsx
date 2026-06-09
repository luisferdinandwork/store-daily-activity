'use client';
// components/ops/layout/OpsNavbar.tsx
//
// Slim top bar that sits above page content.
// Renders a sidebar collapse/expand toggle button on the left edge.
// The `collapsed` + `onToggle` props wire to the layout's shared state,
// keeping OpsSidebar and OpsNavbar in sync without a context provider.

import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  collapsed: boolean;
  onToggle: () => void;
  /** Optional: extra content rendered in the right slot (e.g. notifications, user avatar). */
  right?: React.ReactNode;
  className?: string;
}

export default function OpsNavbar({ collapsed, onToggle, right, className }: Props) {
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
        className={cn(
          'flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors',
          'hover:bg-secondary hover:text-foreground',
        )}
      >
        {collapsed
          ? <PanelLeftOpen  className="h-4 w-4" />
          : <PanelLeftClose className="h-4 w-4" />
        }
      </button>

      {/* Divider */}
      <div className="h-5 w-px bg-border" />

      {/* Breadcrumb / slot — pages can project content here via right prop */}
      <div className="flex flex-1 items-center justify-end gap-2">
        {right}
      </div>
    </header>
  );
}