'use client';
// components/manuals/ManualPreviewOverlay.tsx
//
// Shared in-app preview overlays for Knowledge Base manuals, used by both
// the employee Knowledge Base page and the OPS manuals admin page so both
// surfaces render Excel/PDF files the same way instead of drifting apart.

import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, Download, Loader2 } from 'lucide-react';
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';

export type PreviewableManual = {
  title: string;
  fileUrl: string;
};

type SheetTable = { name: string; rows: string[][] };

export const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp']);
export const SHEET_EXTS = new Set(['xls', 'xlsx']);
export const PDF_EXTS = new Set(['pdf']);

// Excel manuals are parsed and rendered as plain HTML tables so they're
// readable in-app instead of the browser trying (and mostly failing) to
// open/preview a raw .xlsx file.
export function ExcelViewerOverlay({ manual, onClose }: { manual: PreviewableManual; onClose: () => void }) {
  const [sheets, setSheets] = useState<SheetTable[] | null>(null);
  const [activeSheet, setActiveSheet] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [{ read, utils }, res] = await Promise.all([
          import('xlsx'),
          fetch(manual.fileUrl),
        ]);
        if (!res.ok) throw new Error('Failed to download file');

        const buf = await res.arrayBuffer();
        const wb = read(buf, { type: 'array' });
        const parsed = wb.SheetNames.map((name) => ({
          name,
          rows: utils.sheet_to_json<unknown[]>(wb.Sheets[name], {
            header: 1,
            blankrows: false,
            defval: '',
          }).map((row) => row.map((cell) => (cell == null ? '' : String(cell)))),
        }));

        if (!cancelled) setSheets(parsed);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to open this file.');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [manual.fileUrl]);

  const rows = sheets?.[activeSheet]?.rows ?? [];
  const colCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const [headerRow, ...bodyRows] = rows;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-card/90 px-4 py-3.5 backdrop-blur">
        <button
          onClick={onClose}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>

        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-muted-foreground">Knowledge Base</p>
          <p className="truncate text-sm font-bold leading-none text-foreground">{manual.title}</p>
        </div>

        <a
          href={manual.fileUrl}
          download
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground"
        >
          <Download className="h-4 w-4" />
        </a>
      </div>

      {sheets && sheets.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto border-b border-border bg-card px-3 py-2">
          {sheets.map((s, i) => (
            <button
              key={s.name}
              onClick={() => setActiveSheet(i)}
              className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${
                i === activeSheet
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-muted-foreground'
              }`}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-auto p-3">
        {error ? (
          <p className="py-16 text-center text-sm font-medium text-rose-500">{error}</p>
        ) : !sheets ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">This sheet is empty.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="min-w-full border-collapse text-xs">
              {headerRow && (
                <thead className="sticky top-0 bg-secondary">
                  <tr>
                    {Array.from({ length: colCount }, (_, i) => (
                      <th
                        key={i}
                        className="whitespace-nowrap border-b border-border px-2.5 py-2 text-left font-semibold text-foreground"
                      >
                        {headerRow[i] ?? ''}
                      </th>
                    ))}
                  </tr>
                </thead>
              )}
              <tbody>
                {bodyRows.map((row, ri) => (
                  <tr key={ri} className="odd:bg-card even:bg-secondary/30">
                    {Array.from({ length: colCount }, (_, ci) => (
                      <td
                        key={ci}
                        className="whitespace-nowrap border-b border-border px-2.5 py-1.5 text-foreground/90"
                      >
                        {row[ci] ?? ''}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// PDFs are rendered page-by-page onto canvases with pdf.js so they open
// in-app (readable, scrollable, no zooming-into-a-download-tab) instead of
// relying on the browser's own PDF handling, which is inconsistent across
// devices and often just downloads the file.
export function PdfViewerOverlay({ manual, onClose }: { manual: PreviewableManual; onClose: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [numPages, setNumPages] = useState<number | null>(null);
  const [rendering, setRendering] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let loadingTask: PDFDocumentLoadingTask | null = null;

    (async () => {
      try {
        const pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          'pdfjs-dist/build/pdf.worker.min.mjs',
          import.meta.url,
        ).toString();

        loadingTask = pdfjs.getDocument({ url: manual.fileUrl });
        const pdfDoc: PDFDocumentProxy = await loadingTask.promise;
        if (cancelled || !containerRef.current) return;

        setNumPages(pdfDoc.numPages);
        containerRef.current.innerHTML = '';

        const containerWidth = containerRef.current.clientWidth || 360;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);

        for (let i = 1; i <= pdfDoc.numPages; i++) {
          if (cancelled) break;
          const page = await pdfDoc.getPage(i);
          const baseViewport = page.getViewport({ scale: 1 });
          const scale = (containerWidth / baseViewport.width) * dpr;
          const viewport = page.getViewport({ scale });

          if (cancelled || !containerRef.current) break;

          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.style.width = `${viewport.width / dpr}px`;
          canvas.style.height = `${viewport.height / dpr}px`;
          canvas.className = 'mx-auto mb-2.5 block rounded-lg shadow-sm';

          containerRef.current.appendChild(canvas);
          setRendering(false);

          await page.render({ canvas, viewport }).promise;
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to open this PDF.');
      } finally {
        if (!cancelled) setRendering(false);
      }
    })();

    return () => {
      cancelled = true;
      void loadingTask?.destroy();
    };
  }, [manual.fileUrl]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-card/90 px-4 py-3.5 backdrop-blur">
        <button
          onClick={onClose}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>

        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-muted-foreground">
            Knowledge Base{numPages ? ` · ${numPages} page${numPages > 1 ? 's' : ''}` : ''}
          </p>
          <p className="truncate text-sm font-bold leading-none text-foreground">{manual.title}</p>
        </div>

        <a
          href={manual.fileUrl}
          download
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground"
        >
          <Download className="h-4 w-4" />
        </a>
      </div>

      <div className="relative flex-1 overflow-auto bg-secondary/40 p-3">
        {error ? (
          <p className="py-16 text-center text-sm font-medium text-rose-500">{error}</p>
        ) : (
          <>
            {rendering && (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            )}
            <div ref={containerRef} />
          </>
        )}
      </div>
    </div>
  );
}
