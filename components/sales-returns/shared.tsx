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
  salesReturnPhotos,
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
    { label: 'Retur penjualan', value: String(s.count), sub: 'pada periode ini' },
    { label: 'Hari ini', value: String(s.today), sub: 'retur diunggah' },
    { label: 'Toko', value: String(s.stores), sub: 'dengan pengajuan retur' },
    { label: 'Karyawan', value: String(s.employees), sub: 'mengunggah struk' },
    {
      label: 'Retur terbanyak',
      value: s.topStore?.storeNo ?? '–',
      sub: s.topStore ? `${s.topStore.count} retur` : 'belum ada retur',
    },
  ];
}

// ─── Photo thumbnail ─────────────────────────────────────────────────────────

/** Receipt photo; degrades to an icon when the stored URL no longer loads. */
function PhotoThumb({
  url,
  label,
  onOpen,
  hover,
}: {
  url: string;
  label: string;
  onOpen: () => void;
  hover: string;
}) {
  const [failed, setFailed] = useState(false);

  return (
    <button
      type="button"
      onClick={onOpen}
      title={`Lihat ${label.toLowerCase()}`}
      aria-label={`Lihat ${label.toLowerCase()}`}
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
          alt={label}
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
  onOpenDetail,
}: {
  rows: SalesReturnRow[];
  /** Number of rows on earlier pages, so the gutter keeps counting. */
  startIndex: number;
  variant: keyof typeof VARIANT;
  /** Ops HO: a second line under the store name with its area. */
  showArea?: boolean;
  onOpenPhoto: (row: SalesReturnRow, index: number) => void;
  onOpenDetail?: (row: SalesReturnRow) => void;
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
          <th className={cn(v.th, 'text-left')}>No. Struk Lama</th>
          <th className={cn(v.th, 'text-left')}>No. Struk Baru</th>
          <th className={cn(v.th, 'text-left')}>Diunggah Oleh</th>
          <th className={cn(v.th, 'text-center')}>Foto Struk</th>
          {onOpenDetail && <th className={cn(v.th, 'text-center')}>Detail</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.id} onClick={onOpenDetail ? (e) => {
            if (!(e.target as HTMLElement).closest('button, a, input')) onOpenDetail(r);
          } : undefined}
            className={cn('bg-white text-[13px] transition-colors', v.rowHover, onOpenDetail && 'cursor-pointer')}>
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
              <span className="font-mono text-xs text-slate-600">{r.oldReceiptNumber ?? '—'}</span>
            </td>
            <td className={cn(v.td, 'whitespace-nowrap')}>
              <span className="inline-flex items-center gap-1.5">
                <span className="font-mono text-[13px] font-semibold text-slate-900">{r.newReceiptNumber ?? '—'}</span>
                {r.newReceiptNumber && <CopyButton value={r.newReceiptNumber} label="Salin nomor struk baru" />}
              </span>
              {!r.newReceiptNumber && <span className="block text-[10px] text-amber-700">Arsip: {r.receiptNumber} · jenis belum tercatat</span>}
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
                  salesReturnPhotos(r).map(({ url, label }, n) => (
                    <span key={label} className="flex flex-col items-center gap-0.5">
                      <PhotoThumb
                        url={url}
                        label={label}
                        hover={v.thumbHover}
                        onOpen={() => onOpenPhoto(r, n)}
                      />
                      <span className="text-[9px] font-semibold text-slate-500">
                        {label === 'Foto struk lama' ? 'Lama' : label === 'Foto struk baru' ? 'Baru' : `Arsip ${n + 1}`}
                      </span>
                    </span>
                  ))
                )}
              </span>
            </td>
            {onOpenDetail && <td className={cn(v.td, 'text-center')}>
              <button type="button" onClick={() => onOpenDetail(r)} aria-label={`Buka detail retur ${r.newReceiptNumber ?? r.receiptNumber}`}
                className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50">Detail</button>
            </td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
