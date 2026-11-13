'use client';

import { ChevronLeft, ChevronRight, ImageOff, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { ZoomableImage } from '@/components/shared/ZoomableImage';
import { CopyButton } from '@/components/finance/petty-cash/shared';
import { fmtSalesReturnWhen, salesReturnPhotos, type SalesReturnRow } from '@/lib/sales-returns';

export function SalesReturnDetailModal({ row, position, total, busy, error, onNavigate, onClose }: {
  row: SalesReturnRow;
  /** One-based position in the complete filtered/sorted result, including other pages. */
  position: number;
  total: number;
  busy: boolean;
  error: string | null;
  onNavigate: (direction: -1 | 1) => void;
  onClose: () => void;
}) {
  const legacy = !row.newReceiptNumber;
  const photos = legacy ? salesReturnPhotos(row) : [
    { url: row.oldReceiptImageUrl, label: 'Foto struk lama' },
    { url: row.newReceiptImageUrl, label: 'Foto struk baru' },
  ];
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent showCloseButton={false}
        aria-busy={busy}
        className="flex h-[min(94dvh,960px)] w-[min(96vw,1440px)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
        onKeyDown={(e) => {
          const target = e.target as HTMLElement;
          if (e.altKey || e.ctrlKey || e.metaKey || target.closest('input, textarea, select, [contenteditable="true"]')) return;
          const direction = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : null;
          if (direction == null) return;
          e.preventDefault();
          if (!busy && (direction === -1 ? position > 1 : position < total)) onNavigate(direction);
        }}>
        <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-base text-slate-900">Detail Sales Return</DialogTitle>
            <DialogDescription className="mt-1 text-xs">{row.storeNo} · {row.storeName} · #{row.id}</DialogDescription>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => onNavigate(-1)} disabled={busy || position <= 1}
              aria-label="Retur sebelumnya" className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
            <span aria-live="polite" className="flex min-w-20 items-center justify-center gap-1 text-xs font-semibold tabular-nums text-slate-600">
              {busy && <Loader2 className="h-3 w-3 animate-spin" />}{position} / {total}
            </span>
            <button type="button" onClick={() => onNavigate(1)} disabled={busy || position >= total}
              aria-label="Retur berikutnya" className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
          </div>
          <button type="button" onClick={onClose} className="h-9 rounded-md border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50">Tutup</button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50">
          {error && <p role="alert" className="border-b border-rose-200 bg-rose-50 px-4 py-2 text-xs text-rose-700">{error} Gunakan panah untuk mencoba lagi.</p>}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-b border-slate-200 bg-white px-4 py-3 sm:grid-cols-4">
            {[
              { label: legacy ? 'Nomor struk arsip' : 'Nomor struk lama', value: legacy ? row.receiptNumber : row.oldReceiptNumber },
              { label: 'Nomor struk baru', value: row.newReceiptNumber },
              { label: 'Diunggah oleh', value: row.uploadedBy },
              { label: 'Tanggal unggah (WIB)', value: fmtSalesReturnWhen(row.createdAt) },
            ].map(({ label, value }, i) => <div key={label} className="min-w-0">
              <dt className="text-[11px] font-semibold text-slate-500">{label}</dt>
              <dd className="mt-1 flex items-start gap-1 break-all text-xs font-medium text-slate-900">
                <span className={i < 2 ? 'font-mono' : ''}>{value ?? (i === 0 ? 'Tidak diisi (opsional)' : 'Belum tercatat')}</span>
                {i < 2 && value && <CopyButton value={value} label={`Salin ${label.toLowerCase()}`} />}
              </dd>
            </div>)}
          </dl>
          {legacy && <p className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
            Data arsip: jenis nomor dan foto struk lama/baru belum dicatat saat pengajuan ini dibuat.
          </p>}
          <div className="grid grid-cols-2 gap-2 p-2 sm:gap-3 sm:p-3">
            {photos.map((photo, index) => <section key={`${row.id}-${index}`} className="min-w-0 overflow-hidden rounded-lg border border-slate-300 bg-white">
              <h3 className="border-b border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700">{photo.label}</h3>
              {photo.url ? <ZoomableImage key={photo.url} src={photo.url} alt={photo.label} className="h-[max(280px,calc(94dvh-280px))] max-h-[680px]" /> : (
                <div className="flex h-72 flex-col items-center justify-center gap-2 text-slate-400"><ImageOff className="h-8 w-8" /><p className="text-xs">Foto belum tersedia</p></div>
              )}
            </section>)}
          </div>
        </div>
        <footer className="border-t border-slate-200 bg-white px-4 py-2 text-[11px] text-slate-500">
          ← / → untuk retur sebelumnya / berikutnya sesuai filter dan urutan. Gulir pada foto untuk zoom; tarik untuk menggeser.
        </footer>
      </DialogContent>
    </Dialog>
  );
}
