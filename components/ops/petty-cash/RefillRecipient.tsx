'use client';

import { Landmark } from 'lucide-react';
import { CopyButton } from '@/components/finance/petty-cash/shared';
import type { OpsRefillRow } from '@/lib/ops-petty-cash';
import { cn } from '@/lib/utils';

type Recipient = Pick<OpsRefillRow, 'requestedByName' | 'bankName' | 'accountNumber' | 'accountHolderName'>;

/** The employee who requested the refill and the destination saved on that request. */
export function RefillRecipient({ row, compact = false }: { row: Recipient; compact?: boolean }) {
  const account = row.accountNumber;
  const copyAccount = account && (
    <span className="inline-flex shrink-0" onClick={(e) => e.stopPropagation()}>
      <CopyButton value={account} label="Salin nomor rekening" />
    </span>
  );

  if (compact) {
    return (
      <div className="min-w-52 max-w-72 space-y-1 py-0.5">
        <p className="break-words text-[13px] font-semibold leading-snug text-slate-900">
          {row.requestedByName ?? 'Nama belum tercatat'}
        </p>
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
          {row.bankName && <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700">{row.bankName}</span>}
          {account ? (
            <span className="inline-flex items-center gap-1">
              <span className="sr-only">No. rekening: </span>
              <span className="font-mono font-medium tabular-nums text-slate-700">{account}</span>
              {copyAccount}
            </span>
          ) : <span className="text-[11px] text-slate-400">Rekening belum tercatat</span>}
        </div>
        {row.accountHolderName && <p className="break-words text-[11px] leading-snug text-slate-500">a.n. {row.accountHolderName}</p>}
      </div>
    );
  }

  const fields = [
    { label: 'Nama karyawan', value: row.requestedByName },
    { label: 'Bank', value: row.bankName },
    { label: 'No. rekening', value: account, account: true },
    { label: 'Nama pemilik rekening', value: row.accountHolderName },
  ];

  return (
    <section aria-label="Karyawan dan rekening tujuan refill" className="rounded-xl border border-slate-200 bg-white p-3">
      <h3 className="mb-3 flex items-center gap-1.5 text-xs font-semibold text-slate-700">
        <Landmark className="h-3.5 w-3.5 text-indigo-500" /> Rekening tujuan refill
      </h3>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 lg:grid-cols-4">
        {fields.map((field) => (
          <div key={field.label} className="min-w-0">
            <dt className="text-[10px] font-medium text-slate-500">{field.label}</dt>
            <dd className={cn('mt-1 flex items-start gap-1 break-words text-xs font-semibold leading-snug', field.value ? 'text-slate-900' : 'font-normal text-slate-400')}>
              <span className={cn('min-w-0', field.account && 'break-all font-mono tabular-nums')}>{field.value ?? 'Belum tercatat'}</span>
              {field.account && copyAccount}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
