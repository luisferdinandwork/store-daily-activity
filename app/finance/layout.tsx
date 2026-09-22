// app/finance/layout.tsx
//
// Server-side gate for the whole /finance panel (defence in depth behind proxy.ts —
// see lib/auth/guards.ts). The UI chrome lives in the client component FinanceShell.
import { ReactNode } from 'react';
import { requirePanel } from '@/lib/auth/guards';
import FinanceShell from './FinanceShell';

export default async function FinanceLayout({ children }: { children: ReactNode }) {
  await requirePanel('/finance');
  return <FinanceShell>{children}</FinanceShell>;
}
