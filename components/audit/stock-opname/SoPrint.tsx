'use client';
// components/audit/stock-opname/SoPrint.tsx
//
// Printing + previewing the three Stock Opname documents.
//   - <SoPrintPortal kind> renders ONE document straight under <body>, hidden on screen. The @media print rules hide
//     every other child of <body>, so the paper (or "Simpan sebagai PDF") holds only that document:
//       · Berita Acara SO = A4 portrait, the BA sheet at the sheet's own page setup (margins 0.75" / 0.7", zoom 85 %);
//       · Surat Pernyataan = A4 portrait, the Word page itself (its own 1" margins are part of the layout);
//       · Super Reward = A4 LANDSCAPE, the Super Reward sheet at its page setup (margins 0.75" / 0.7", zoom 50 %).
//   - printSoDocument() names the PDF ("BA Stock Opname FS020 2026-09-16") through document.title while the print
//     dialog is open.
//   - <SoPaperPreview> shows the same page on screen, scaled to the available width, with a zoom toggle.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Maximize2, Minimize2 } from 'lucide-react';

import type { StockOpnameRecord } from '@/lib/audit-stock-opname';
import { useHydrated } from '@/lib/hooks/useHydrated';
import SoBeritaAcaraDocument from './SoBeritaAcaraDocument';
import SuratPernyataanDocument from './SuratPernyataanDocument';
import SuperRewardDocument from './SuperRewardDocument';

export type SoDocKind = 'ba' | 'surat' | 'reward';

export const SO_DOC_LABEL: Record<SoDocKind, string> = {
  ba: 'Berita Acara Stock Opname',
  surat: 'Surat Pernyataan Hasil SO',
  reward: 'Super Reward',
};

const PDF_NAME: Record<SoDocKind, string> = {
  ba: 'BA Stock Opname',
  surat: 'Surat Pernyataan SO',
  reward: 'Super Reward SO',
};

// A4 at 96 dpi.
const A4_SHORT = 794;
const A4_LONG = 1123;
const pageSize = (kind: SoDocKind) => (kind === 'reward' ? { w: A4_LONG, h: A4_SHORT } : { w: A4_SHORT, h: A4_LONG });

const BA_ZOOM = 0.85;
const REWARD_ZOOM = 0.5;
// The BA and Super Reward sheets' margins: top/bottom 0.75", left/right 0.7".
const SHEET_PAD = { top: 72, side: 67 };

const printCss = (kind: SoDocKind) => `
.so-print-root { display: none; }
@media print {
  @page { size: A4 ${kind === 'reward' ? 'landscape' : 'portrait'}; margin: 0; }
  html, body { background: #fff !important; height: auto !important; overflow: visible !important; }
  body > *:not(.so-print-root) { display: none !important; }
  .so-print-root { display: block !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .so-print-root .so-print-sheet { padding: ${SHEET_PAD.top}px ${SHEET_PAD.side}px; }
  .so-print-root .so-ba-doc { zoom: ${BA_ZOOM}; }
  .so-print-root .so-reward-doc { zoom: ${REWARD_ZOOM}; }
  .so-print-root tr { break-inside: avoid; }
}
`;

/** One page of a document: the two Excel sheets with their margins + zoom, the Surat as its own page. */
function Page({ record, kind }: { record: StockOpnameRecord; kind: SoDocKind }) {
  if (kind === 'surat') return <SuratPernyataanDocument record={record} />;
  return <div className="so-print-sheet">{kind === 'ba' ? <SoBeritaAcaraDocument record={record} /> : <SuperRewardDocument record={record} />}</div>;
}

export function SoPrintPortal({ record, kind }: { record: StockOpnameRecord; kind: SoDocKind }) {
  const host = useHydrated() ? document.body : null;
  return (
    <>
      <style>{printCss(kind)}</style>
      {host &&
        createPortal(
          <div className="so-print-root" aria-hidden="true">
            <Page record={record} kind={kind} />
          </div>,
          host,
        )}
    </>
  );
}

/** Opens the print dialog for what the portal holds (set `kind` on the portal first). */
export function printSoDocument(record: StockOpnameRecord, kind: SoDocKind) {
  const previous = document.title;
  document.title = `${PDF_NAME[kind]} ${record.storeNo} ${record.soDate}`;
  const restore = () => {
    document.title = previous;
    window.removeEventListener('afterprint', restore);
  };
  window.addEventListener('afterprint', restore);
  window.print();
  // Some mobile browsers never fire afterprint.
  window.setTimeout(restore, 60_000);
}

/** The page on screen. "Perbesar" shows it at 100 % — for the Super Reward (printed at 50 %) at the sheet's 100 %. */
export function SoPaperPreview({ record, kind }: { record: StockOpnameRecord; kind: SoDocKind }) {
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

  const page = pageSize(kind);
  const zoomed = kind === 'reward' ? 1 / REWARD_ZOOM : 1;
  const fit = width ? Math.min(1, width / page.w) : 0;
  const scale = full ? zoomed : fit;

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-200/70">
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-white px-3 py-2">
        <p className="text-xs font-semibold text-slate-500">
          Pratinjau cetak · A4 {kind === 'reward' ? 'landscape' : ''} · {SO_DOC_LABEL[kind]}
        </p>
        {fit < zoomed && (
          <button
            type="button"
            onClick={() => setFull((v) => !v)}
            className="flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-xs font-bold text-slate-600 hover:bg-slate-100"
          >
            {full ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            {full ? 'Sesuaikan layar' : kind === 'reward' ? 'Perbesar tabel' : 'Perbesar 100%'}
          </button>
        )}
      </div>
      <div ref={box} className={full ? 'overflow-x-auto p-3' : 'p-3'}>
        {width > 0 && (
          <div className="mx-auto bg-white shadow-[0_2px_12px_rgba(15,23,42,0.18)]" style={{ width: page.w, minHeight: page.h, zoom: scale }}>
            {kind === 'surat' ? (
              <SuratPernyataanDocument record={record} />
            ) : (
              <div style={{ padding: `${SHEET_PAD.top}px ${SHEET_PAD.side}px` }}>
                <div style={{ zoom: kind === 'ba' ? BA_ZOOM : REWARD_ZOOM }}>
                  {kind === 'ba' ? <SoBeritaAcaraDocument record={record} /> : <SuperRewardDocument record={record} />}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
