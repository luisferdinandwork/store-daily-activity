'use client';
// lib/hooks/useHydrated.ts
//
// `false` on the server and during hydration, `true` afterwards. Use it to hold
// back UI whose layout depends on something only the client knows for sure
// (a context a shell fills in, a portal target) so the first client render
// matches the server HTML.

import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};

export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, () => true, () => false);
}
