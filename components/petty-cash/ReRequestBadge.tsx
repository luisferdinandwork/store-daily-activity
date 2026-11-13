// components/petty-cash/ReRequestBadge.tsx
//
// The "Re-request" mark (lib/petty-cash-re-request.ts) — one look for every page that lists petty cash
// requests: Finance Monitoring / Transactions, Ops Requests / Refills and the employee app.

import { RotateCcw } from 'lucide-react';

import { cn } from '@/lib/utils';
import { RE_REQUEST_LABEL } from '@/lib/petty-cash-re-request';

export function ReRequestBadge({ className }: { className?: string }) {
  return (
    <span
      title="Request yang diperbaiki PIC 1 setelah Perlu Perbaikan dari Finance (lalu disetujui OPS lagi)"
      className={cn(
        'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-bold text-violet-700 ring-1 ring-inset ring-violet-200',
        className,
      )}
    >
      <RotateCcw className="h-2.5 w-2.5" aria-hidden />
      {RE_REQUEST_LABEL}
    </span>
  );
}
