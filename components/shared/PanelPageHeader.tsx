'use client';

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

export type PanelTone = 'cyan' | 'indigo' | 'emerald' | 'amber';
const SCOPE_TONES: Record<PanelTone, string> = {
  cyan: 'bg-cyan-50 text-cyan-700 ring-cyan-600/10',
  indigo: 'bg-indigo-50 text-indigo-700 ring-indigo-600/10',
  emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-600/10',
  amber: 'bg-amber-50 text-amber-800 ring-amber-600/10',
};

const HeaderContext = createContext<{
  target: HTMLDivElement | null;
  setTarget: (target: HTMLDivElement | null) => void;
  tone: PanelTone;
} | null>(null);

/** Pages keep ownership of their live title/actions; the shell provides their location. */
export function PanelPageHeaderProvider({ children, tone = 'cyan' }: { children: ReactNode; tone?: PanelTone }) {
  const [target, setTarget] = useState<HTMLDivElement | null>(null);
  const value = useMemo(() => ({ target, setTarget, tone }), [target, tone]);
  return <HeaderContext.Provider value={value}>{children}</HeaderContext.Provider>;
}

export function PanelPageHeaderOutlet() {
  const header = useContext(HeaderContext);
  return <div ref={header?.setTarget} className="contents" />;
}

export function usePanelPageHeader() {
  return useContext(HeaderContext);
}

interface Props {
  scope?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  tabs?: ReactNode;
  /** Period/date controls need more room before joining the title row. */
  wideActions?: boolean;
  /** Alternate mobile/desktop page views still share one navbar outlet. */
  display?: 'all' | 'desktop' | 'mobile';
}

/** A single compact identity/action row, rendered inside the panel's top navbar. */
export default function PanelPageHeader({ scope, title, subtitle, actions, tabs, wideActions = false, display = 'all' }: Props) {
  const header = usePanelPageHeader();
  const content = (
    <div className={header
      ? display === 'desktop' ? 'hidden md:contents' : display === 'mobile' ? 'contents md:hidden' : 'contents'
      : 'flex min-w-0 flex-wrap items-center gap-4'}>
      <div className={header ? 'col-start-2 row-start-1 min-w-0 py-1 md:col-start-3' : 'min-w-0 flex-1'}>
        <div className="flex min-w-0 items-center gap-2">
          {scope && <span title={typeof scope === 'string' ? scope : undefined} className={cn('max-w-[45%] shrink-0 truncate rounded-md px-1.5 py-1 text-[10px] font-bold uppercase leading-none tracking-wide ring-1 ring-inset', SCOPE_TONES[header?.tone ?? 'cyan'])}>{scope}</span>}
          <h1 className="flex min-w-0 items-center gap-2 text-base font-bold leading-snug tracking-tight text-slate-900 sm:text-lg [&>svg]:hidden sm:[&>svg]:block sm:[&>svg]:h-4 sm:[&>svg]:w-4 sm:[&>svg]:shrink-0">{title}</h1>
        </div>
        {subtitle && <div className="mt-1 text-xs leading-relaxed text-slate-500">{subtitle}</div>}
      </div>
      {actions && <div className={cn(
        'flex min-w-0 flex-wrap items-center gap-2 [&_button]:min-h-10 [&_a]:min-h-10',
        header && 'col-span-full row-start-2 pb-1 pt-2',
        header && (wideActions
          ? '@6xl:col-span-1 @6xl:col-start-4 @6xl:row-start-1 @6xl:py-0'
          : '@4xl:col-span-1 @4xl:col-start-4 @4xl:row-start-1 @4xl:py-0'),
      )}>{actions}</div>}
      {tabs && <div className="col-span-full row-start-3 w-full border-t border-slate-100 pt-1">{tabs}</div>}
    </div>
  );
  if (header) return header.target ? createPortal(content, header.target) : null;
  return <div className="@container border-b border-slate-200 bg-white px-4 py-3 sm:px-6">{content}</div>;
}
