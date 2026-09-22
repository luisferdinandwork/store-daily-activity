// app/audit/layout.tsx
//
// Server-side gate for the whole /audit panel (defence in depth behind proxy.ts —
// see lib/auth/guards.ts). The UI chrome lives in the client component AuditShell.
import { ReactNode } from 'react';
import { requirePanel } from '@/lib/auth/guards';
import AuditShell from './AuditShell';

export default async function AuditLayout({ children }: { children: ReactNode }) {
  await requirePanel('/audit');
  return <AuditShell>{children}</AuditShell>;
}
