'use client';

import { Menu, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { PanelPageHeaderOutlet } from './PanelPageHeader';

export interface PanelNavbarProps {
  collapsed: boolean;
  onToggle: () => void;
  onOpenMenu?: () => void;
  right?: ReactNode;
  className?: string;
}

export default function PanelNavbar({ collapsed, onToggle, onOpenMenu, right, className }: PanelNavbarProps) {
  const control = 'col-start-1 row-start-1 h-11 w-11 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400';
  return (
    <header data-panel-header className={cn('@container relative z-20 grid min-h-[72px] shrink-0 grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-x-2 border-b border-slate-200 bg-white px-3 py-2 sm:gap-x-4 sm:px-4 md:grid-cols-[auto_1px_minmax(0,1fr)_auto_auto]', className)}>
      {onOpenMenu && <button type="button" onClick={onOpenMenu} aria-label="Buka menu" className={cn(control, 'flex md:hidden')}><Menu className="h-5 w-5" /></button>}
      <button type="button" onClick={onToggle} aria-label={collapsed ? 'Perluas menu' : 'Ciutkan menu'} aria-expanded={!collapsed} className={cn(control, 'hidden md:flex')}>
        {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
      </button>
      <div aria-hidden="true" className="col-start-2 row-start-1 hidden h-7 w-px bg-slate-200 md:block" />
      <PanelPageHeaderOutlet />
      <div className="col-start-4 row-start-1 flex items-center justify-end gap-1.5 md:col-start-5">{right}</div>
    </header>
  );
}
