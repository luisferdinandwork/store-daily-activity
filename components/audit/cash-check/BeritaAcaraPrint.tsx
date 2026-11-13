'use client';
// components/audit/cash-check/BeritaAcaraPrint.tsx
//
// Printing + previewing the Berita Acara.
//   - <BeritaAcaraPrintPortal> renders the document a second time straight under <body>, hidden on screen. The
//     @media print rules hide every other child of <body> (the whole panel, toasts, dialogs), so the paper holds
//     only the document, zoomed to fit A4 portrait and centred like the Excel's print setup. Long PENGELUARAN lists
//     simply flow onto a second page.
//   - printBeritaAcara() names the PDF ("BA Pemeriksaan Kas FS020 2026-09-16") through document.title while the
//     print dialog is open.
//   - <PaperPreview> shows the same document on screen, scaled to the available width (a phone shows the whole
//     page), with a 100 % toggle that scrolls sideways.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Maximize2, Minimize2 } from 'lucide-react';

import type { CashCheckRecord } from '@/lib/audit-cash-check';
import { useHydrated } from '@/lib/hooks/useHydrated';
import BeritaAcaraDocument, { DOC_WIDTH } from './BeritaAcaraDocument';

// A4 portrait minus 6 mm margins ≈ 198 × 285 mm ≈ 748 × 1077 px at 96 dpi; the sheet is DOC_WIDTH px wide.
const PRINT_ZOOM = 0.63;
/** Below this the text gets too small to read; a longer Berita Acara flows onto a second page instead. */
const MIN_PRINT_ZOOM = 0.5;
const PAGE_HEIGHT_PX = 1060;

/** Shrinks the printed sheet (like Excel's "fit to page") so a long PENGELUARAN list still fits one A4 page. */
function fitPrintToPage() {
  const doc = document.querySelector<HTMLTableElement>('.ba-print-root .ba-doc');
  if (!doc) return;
  const natural = [...doc.rows].reduce((sum, row) => sum + (parseFloat(row.style.height) || 19), 0);
  doc.style.zoom = String(Math.max(MIN_PRINT_ZOOM, Math.min(PRINT_ZOOM, PAGE_HEIGHT_PX / natural)));
}

const PRINT_CSS = `
.ba-print-root { display: none; }
@media print {
  @page { size: A4 portrait; margin: 6mm; }
  html, body { background: #fff !important; height: auto !important; overflow: visible !important; }
  body > *:not(.ba-print-root) { display: none !important; }
  .ba-print-root { display: block !important; }
  .ba-print-root .ba-doc { zoom: ${PRINT_ZOOM}; margin: 0 auto; }
  .ba-print-root tr { break-inside: avoid; }
}
`;

export function BeritaAcaraPrintPortal({ record }: { record: CashCheckRecord }) {
  const host = useHydrated() ? document.body : null;
  // Ctrl+P / the browser menu print too, not only the Cetak button.
  useEffect(() => {
    window.addEventListener('beforeprint', fitPrintToPage);
    return () => window.removeEventListener('beforeprint', fitPrintToPage);
  }, []);
  return (
    <>
      <style>{PRINT_CSS}</style>
      {host &&
        createPortal(
          <div className="ba-print-root" aria-hidden="true">
            <BeritaAcaraDocument record={record} />
          </div>,
          host,
        )}
    </>
  );
}

export function printBeritaAcara(record: CashCheckRecord) {
  const previous = document.title;
  document.title = `BA Pemeriksaan Kas ${record.storeNo} ${record.checkDate}`;
  const restore = () => {
    document.title = previous;
    window.removeEventListener('afterprint', restore);
  };
  window.addEventListener('afterprint', restore);
  fitPrintToPage();
  window.print();
  // Some mobile browsers never fire afterprint.
  window.setTimeout(restore, 60_000);
}

const PAPER_PAD = 28;

export function PaperPreview({ record }: { record: CashCheckRecord }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [full, setFull] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const paperWidth = DOC_WIDTH + PAPER_PAD * 2;
  const fit = width ? Math.min(1, width / paperWidth) : 0;
  const scale = full ? 1 : fit;

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-200/70">
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-white px-3 py-2">
        <p className="text-xs font-semibold text-slate-500">Pratinjau cetak · A4</p>
        {fit < 1 && (
          <button
            type="button"
            onClick={() => setFull((v) => !v)}
            className="flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-xs font-bold text-slate-600 hover:bg-slate-100"
          >
            {full ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            {full ? 'Sesuaikan layar' : 'Perbesar 100%'}
          </button>
        )}
      </div>
      <div ref={box} className={full ? 'overflow-x-auto p-3' : 'p-3'}>
        {width > 0 && (
          <div
            className="mx-auto bg-white shadow-[0_2px_12px_rgba(15,23,42,0.18)]"
            style={{ width: paperWidth, padding: PAPER_PAD, zoom: scale }}
          >
            <BeritaAcaraDocument record={record} />
          </div>
        )}
      </div>
    </div>
  );
}
