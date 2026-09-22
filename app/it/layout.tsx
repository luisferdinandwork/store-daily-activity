// app/it/layout.tsx
//
// Server-side gate for the whole /it panel (defence in depth behind proxy.ts —
// see lib/auth/guards.ts). The UI chrome lives in the client component ItShell.
import { ReactNode } from 'react';
import { requirePanel } from '@/lib/auth/guards';
import ItShell from './ItShell';

export default async function ItLayout({ children }: { children: ReactNode }) {
  await requirePanel('/it');
  return <ItShell>{children}</ItShell>;
}
