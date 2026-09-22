// app/ops/layout.tsx
//
// Server-side gate for the whole /ops panel (defence in depth behind proxy.ts —
// see lib/auth/guards.ts). The UI chrome lives in the client component OpsShell.
import { ReactNode } from 'react';
import { requirePanel } from '@/lib/auth/guards';
import OpsShell from './OpsShell';

export default async function OpsLayout({ children }: { children: ReactNode }) {
  await requirePanel('/ops');
  return <OpsShell>{children}</OpsShell>;
}
