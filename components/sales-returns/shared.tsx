'use client';
// components/sales-returns/shared.tsx
//
// Pieces both back-office Sales Return pages (Finance + Ops) are drawn with: the
// receipt sheet itself, photo thumbnails, the key-number strip and a debounce for
// the search box. The sheet look (grey header, row-number gutter, thin grid) is
// Finance's — Ops passes `variant="ops"` for its non-sticky header and indigo accent.

import { useEffect, useState } from 'react';
import { ImageOff } from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  CopyButton,
  SHEET_ROW_HEAD,
  SHEET_TD,
  SHEET_TH,
} from '@/components/finance/petty-cash/shared';
import { TD as OPS_TD, TH as OPS_TH } from '@/components/ops/petty-cash/shared';
import type { KpiItem } from '@/components/finance/shared/sheet-kit';
import {
  fmtSalesReturnWhen,
  type SalesReturnRow,
  type SalesReturnSummary,
} from '@/lib/sales-returns';

// ─── Debounce ────────────────────────────────────────────────────────────────

/** `value`, but only after it has stopped changing for `ms` — keeps typing from firing a request per key. */
export function useDebouncedValue<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);

  return debounced;
}

// ─── Key numbers ─────────────────────────────────────────────────────────────

export function salesReturnKpis(s: SalesReturnSummary): KpiItem[] {
  return [
    { label: 'Sales returns', value: String(s.count), sub: 'in this period' },
    { label: 'Today', value: String(s.today), sub: 'filed today' },
    { label: 'Stores', value: String(s.stores), sub: 'with at least one return' },
    { label: 'Employees', value: String(s.employees), sub: 'uploaded a receipt' },
    {
      label: 'Most returns',
      value: s.topStore?.storeNo ?? '–',
      sub: s.topStore ? `${s.topStore.count} return${s.topStore.count === 1 ? '' : 's'}` : 'no returns yet',
    },
  ];
}

// ─── Photo thumbnail ─────────────────────────────────────────────────────────

/** Receipt photo; degrades to an icon when the stored URL no longer loads. */
function PhotoThumb({
  url,
  n,
  onOpen,
  hover,
}: {
  url: string;
  n: number;
  onOpen: () => void;
  hover: string;
}) {
  const [failed, setFailed] = useState(false);

  return (
    <button
      type="button"
      onClick={onOpen}
      title={`Lihat foto struk ${n}`}
      className={cn(
        'flex h-9 w-9 items-center justify-center overflow-hidden rounded border border-slate-300 bg-slate-100 transition',
        hover,
      )}
    >
      {failed ? (
        <ImageOff className="h-3.5 w-3.5 text-slate-400" />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={`Struk ${n}`}
          loading="lazy"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      )}
    </button>
  );
}

// ─── Sheet ───────────────────────────────────────────────────────────────────

const VARIANT = {
  finance: {
    th: SHEET_TH,
    td: SHEET_TD,
    rowHover: 'hover:bg-emerald-50/40',
    thumbHover: 'hover:border-emerald-500',
  },
  ops: {
    th: OPS_TH,
    td: OPS_TD,
    rowHover: 'hover:bg-indigo-50/40',
    thumbHover: 'hover:border-indigo-500',
  },
} as const;

/**
 * One row per sales return. The caller supplies the scroll frame (Finance: sticky
 * header in a max-height box; Ops: SheetFrame) and the pager; `onOpenPhoto` opens
 * the lightbox at that photo.
 */
export function SalesReturnsTable({
  rows,
  startIndex,
  variant,
  showArea = false,
  onOpenPhoto,
}: {
  rows: SalesReturnRow[];
  /** Number of rows on earlier pages, so the gutter keeps counting. */
  startIndex: number;
  variant: keyof typeof VARIANT;
  /** Ops HO: a second line under the store name with its area. */
  showArea?: boolean;
  onOpenPhoto: (row: SalesReturnRow, index: number) => void;
}) {
  const v = VARIANT[variant];

  return (
    <table className="w-full min-w-[980px] border-separate border-spacing-0 text-left">
      <thead>
        <tr>
          <th className={cn(v.th, 'w-11 text-center')}>No</th>
          <th className={cn(v.th, 'text-left')}>Tanggal</th>
          <th className={cn(v.th, 'text-left')}>Kode</th>
          <th className={cn(v.th, 'text-left')}>Nama Toko</th>
          <th className={cn(v.th, 'text-left')}>No. Struk</th>
          <th className={cn(v.th, 'text-left')}>Diunggah Oleh</th>
          <th className={cn(v.th, 'text-center')}>Foto Struk</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.id} className={cn('bg-white text-[13px] transition-colors', v.rowHover)}>
            <td className={cn(SHEET_ROW_HEAD, 'w-11')}>{startIndex + i + 1}</td>
            <td className={cn(v.td, 'w-44 whitespace-nowrap text-slate-600')}>{fmtSalesReturnWhen(r.createdAt)}</td>
            <td className={cn(v.td, 'w-24 whitespace-nowrap font-mono text-xs font-semibold text-slate-600')}>
              {r.storeNo}
            </td>
            <td className={cn(v.td, 'min-w-48 font-medium text-slate-900')}>
              {r.storeName}
              {showArea && r.areaName && (
                <span className="block text-[11px] font-normal leading-snug text-slate-400">{r.areaName}</span>
              )}
            </td>
            <td className={cn(v.td, 'whitespace-nowrap')}>
              <span className="inline-flex items-center gap-1.5">
                <span className="font-mono text-[13px] font-semibold text-slate-900">{r.receiptNumber}</span>
                <CopyButton value={r.receiptNumber} label="Salin nomor struk" />
              </span>
            </td>
            <td className={cn(v.td, 'whitespace-nowrap text-slate-600')}>{r.uploadedBy}</td>
            <td className={cn(v.td, 'w-36 py-1')}>
              <span className="flex items-center justify-center gap-1">
                {r.imageUrls.length === 0 ? (
                  <span
                    title="Tidak ada foto"
                    className="flex h-9 w-9 items-center justify-center rounded border border-dashed border-slate-300 bg-slate-50"
                  >
                    <ImageOff className="h-3.5 w-3.5 text-slate-300" />
                  </span>
                ) : (
                  r.imageUrls.map((url, n) => (
                    <PhotoThumb
                      key={url}
                      url={url}
                      n={n + 1}
                      hover={v.thumbHover}
                      onOpen={() => onOpenPhoto(r, n)}
                    />
                  ))
                )}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
