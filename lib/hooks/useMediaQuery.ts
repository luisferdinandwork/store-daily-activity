'use client';
// lib/hooks/useMediaQuery.ts
//
// `true` while the CSS media query matches. Server render (and hydration) uses
// `serverValue`, then the real value — so prefer CSS (`md:hidden`) for what is
// merely shown or hidden, and this hook for what must not run twice (polling,
// fetching) or can't be expressed in CSS.

import { useCallback, useSyncExternalStore } from 'react';

export function useMediaQuery(query: string, serverValue = false): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    [query],
  );

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => serverValue,
  );
}

/** Below Tailwind's `md` breakpoint (768px) — the phone layout. */
export const MOBILE_QUERY = '(max-width: 767.98px)';
