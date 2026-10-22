'use client';

import { useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import PanelNavbar from './PanelNavbar';
import { PanelPageHeaderProvider, type PanelTone } from './PanelPageHeader';

interface Props {
  name: string;
  tone: PanelTone;
  sidebar: (collapsed: boolean) => ReactNode;
  children: ReactNode;
  right?: ReactNode;
  banners?: ReactNode;
  afterHeader?: ReactNode;
  footer?: ReactNode;
}

/** Shared panel chrome: one page header, a desktop sidebar, and an accessible mobile drawer. */
export default function PanelShell({ name, tone, sidebar, children, right, banners, afterHeader, footer }: Props) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [drawerPath, setDrawerPath] = useState<string | null>(null);
  return (
    <PanelPageHeaderProvider tone={tone}>
      <div className="flex h-dvh overflow-hidden bg-slate-50">
        <div className="hidden shrink-0 md:flex">{sidebar(collapsed)}</div>
        <Sheet open={drawerPath === pathname} onOpenChange={(open) => setDrawerPath(open ? pathname : null)}>
          <SheetContent side="left" className="w-64 gap-0 border-0 p-0" onClickCapture={(event) => {
            if (event.target instanceof Element && event.target.closest('a[href]')) setDrawerPath(null);
          }}>
            <SheetTitle className="sr-only">Menu {name}</SheetTitle>
            <SheetDescription className="sr-only">Navigasi halaman panel {name}.</SheetDescription>
            {sidebar(false)}
          </SheetContent>
        </Sheet>
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {banners}
          <PanelNavbar collapsed={collapsed} onToggle={() => setCollapsed((value) => !value)} onOpenMenu={() => setDrawerPath(pathname)} right={right} />
          {afterHeader}
          <main data-panel-scroll className="relative min-h-0 min-w-0 flex-1 overflow-y-auto">{children}</main>
          {footer}
        </div>
      </div>
    </PanelPageHeaderProvider>
  );
}
