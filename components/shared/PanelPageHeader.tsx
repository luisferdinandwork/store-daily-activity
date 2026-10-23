'use client';

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { useHydrated } from '@/lib/hooks/useHydrated';

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
  /** `actions` is a lone icon-able button (refresh): on a phone it sits in the title row, next to the bell. */
  compactActions?: boolean;
}

/** A single compact identity/action row, rendered inside the panel's top navbar. */
export default function PanelPageHeader({ scope, title, subtitle, actions, tabs, wideActions = false, display = 'all', compactActions = false }: Props) {
  const header = usePanelPageHeader();
  const hydrated = useHydrated();
  const content = (
    <div className={header
      ? display === 'desktop' ? 'hidden md:contents' : display === 'mobile' ? 'contents md:hidden' : 'contents'
      : 'flex min-w-0 flex-wrap items-center gap-4'}>
      <div className={header ? 'col-start-2 row-start-1 min-w-0 py-1 md:col-start-3' : 'min-w-0 flex-1'}>
        {/* Phone: scope is a small eyebrow over the title (a pill beside it eats the title's width); sm+: pill beside the title. */}
        <div className="flex min-w-0 flex-col sm:flex-row sm:items-center sm:gap-2">
          {scope && <span title={typeof scope === 'string' ? scope : undefined} className={cn('truncate text-[10px] font-bold uppercase leading-none tracking-wider max-sm:mb-0.5 max-sm:max-w-full sm:max-w-[45%] sm:shrink-0 sm:rounded-md sm:px-1.5 sm:py-1 sm:ring-1 sm:ring-inset', SCOPE_TONES[header?.tone ?? 'cyan'], 'max-sm:bg-transparent')}>{scope}</span>}
          <h1 className="flex min-w-0 items-center gap-2 truncate text-[17px] font-bold leading-tight tracking-tight text-slate-900 sm:text-lg [&>svg]:hidden sm:[&>svg]:block sm:[&>svg]:h-4 sm:[&>svg]:w-4 sm:[&>svg]:shrink-0">{title}</h1>
        </div>
        {subtitle && <div className="mt-0.5 truncate text-xs leading-relaxed text-slate-500 sm:mt-1 sm:whitespace-normal">{subtitle}</div>}
      </div>
      {actions && <div className={cn(
        'flex min-w-0 flex-wrap items-center gap-2 [&_button]:min-h-10 [&_a]:min-h-10',
        header && 'col-span-full row-start-2 pb-1 pt-2',
        header && compactActions && 'max-md:col-span-1 max-md:col-start-3 max-md:row-start-1 max-md:p-0',
        header && (wideActions
          ? '@6xl:col-span-1 @6xl:col-start-4 @6xl:row-start-1 @6xl:py-0'
          : '@4xl:col-span-1 @4xl:col-start-4 @4xl:row-start-1 @4xl:py-0'),
      )}>{actions}</div>}
      {tabs && <div className="col-span-full row-start-3 w-full border-t border-slate-100 pt-1">{tabs}</div>}
    </div>
  );
  // Server + hydration render nothing: the shell's portal target only exists on the client,
  // and which of the two layouts applies must not differ between the two renders.
  if (!hydrated) return null;
  if (header) return header.target ? createPortal(content, header.target) : null;
  return <div className="@container border-b border-slate-200 bg-white px-4 py-3 sm:px-6">{content}</div>;
}
