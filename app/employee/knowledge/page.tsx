'use client';
// app/employee/knowledge/page.tsx
//
// Knowledge Manual — read-only list of store-operations manuals uploaded by
// Ops HO. Reached from the floating "More" menu (replaces the old dead
// "Help & FAQ" link). Secondary utility page, so it follows the same simple
// sticky back-button header convention as Petty Cash rather than the hero
// header used by the 6 primary bottom-nav pages.

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  BookOpen,
  ChevronLeft,
  Download,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Loader2,
} from 'lucide-react';
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';

type ManualRow = {
  id: string;
  title: string;
  description: string | null;
  fileUrl: string;
  fileType: string;
  createdAt: string;
};

type SheetTable = { name: string; rows: string[][] };

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp']);
const SHEET_EXTS = new Set(['xls', 'xlsx']);
const PDF_EXTS = new Set(['pdf']);

function fileIcon(fileType: string) {
  const ext = fileType.toLowerCase();
  if (IMAGE_EXTS.has(ext)) return { Icon: ImageIcon, color: 'text-sky-500', bg: 'bg-sky-50' };
  if (SHEET_EXTS.has(ext)) return { Icon: FileSpreadsheet, color: 'text-emerald-500', bg: 'bg-emerald-50' };
  return { Icon: FileText, color: 'text-rose-500', bg: 'bg-rose-50' };
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Excel manuals are parsed and rendered as plain HTML tables so they're
// readable on a phone in-app, instead of the browser trying (and mostly
// failing) to open/preview a raw .xlsx file.
function ExcelViewerOverlay({ manual, onClose }: { manual: ManualRow; onClose: () => void }) {
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
          <p className="text-xs font-semibold text-muted-foreground">Knowledge Manual</p>
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
// relying on the mobile browser's own PDF handling, which is inconsistent
// across devices and often just downloads the file.
function PdfViewerOverlay({ manual, onClose }: { manual: ManualRow; onClose: () => void }) {
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
            Knowledge Manual{numPages ? ` · ${numPages} page${numPages > 1 ? 's' : ''}` : ''}
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

export default function KnowledgeManualPage() {
  const [manuals, setManuals] = useState<ManualRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<ManualRow | null>(null);
  const [viewingPdf, setViewingPdf] = useState<ManualRow | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/employee/manuals', { cache: 'no-store' });
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error ?? 'Failed to load manuals');
        setManuals(json.manuals);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load manuals');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="flex h-full flex-col bg-background pb-16">
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-card/90 px-4 py-3.5 backdrop-blur">
        <Link
          href="/employee"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
        </Link>

        <div>
          <p className="text-xs font-semibold text-muted-foreground">Store Operations</p>
          <p className="text-sm font-bold leading-none text-foreground">Knowledge Manual</p>
        </div>
      </div>

      <div className="flex-1 space-y-2.5 overflow-y-auto px-4 py-4">
        {loading ? (
          <div className="flex flex-1 items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <p className="text-sm font-medium text-rose-500">{error}</p>
          </div>
        ) : manuals.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
              <BookOpen className="h-6 w-6 text-muted-foreground/50" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">No manuals yet</p>
              <p className="mt-1 text-xs text-muted-foreground">Store manuals will appear here once uploaded.</p>
            </div>
          </div>
        ) : (
          manuals.map((m) => {
            const { Icon, color, bg } = fileIcon(m.fileType);
            const isSheet = SHEET_EXTS.has(m.fileType.toLowerCase());
            const isPdf = PDF_EXTS.has(m.fileType.toLowerCase());
            const cardInner = (
              <>
                <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${bg}`}>
                  <Icon className={`h-5 w-5 ${color}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-foreground">{m.title}</p>
                  {m.description && (
                    <p className="truncate text-xs text-muted-foreground">{m.description}</p>
                  )}
                  <p className="mt-0.5 flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground/70">
                    <span className="uppercase">{m.fileType}</span>
                    <span>&middot;</span>
                    <span>{fmtDate(m.createdAt)}</span>
                  </p>
                </div>
                <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground/50" />
              </>
            );

            // Excel files are parsed into HTML tables (ExcelViewerOverlay) and PDFs
            // are rendered page-by-page with pdf.js (PdfViewerOverlay) so both open
            // in-app; everything else (image/Word) opens as a normal browser tab/download.
            if (isSheet || isPdf) {
              return (
                <button
                  key={m.id}
                  onClick={() => (isPdf ? setViewingPdf(m) : setViewing(m))}
                  className="flex w-full items-center gap-3 rounded-2xl border border-border bg-card p-3.5 text-left shadow-sm transition-colors hover:bg-secondary/60 active:scale-[0.99]"
                >
                  {cardInner}
                </button>
              );
            }

            return (
              <a
                key={m.id}
                href={m.fileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3.5 shadow-sm transition-colors hover:bg-secondary/60 active:scale-[0.99]"
              >
                {cardInner}
              </a>
            );
          })
        )}
      </div>

      {viewing && <ExcelViewerOverlay manual={viewing} onClose={() => setViewing(null)} />}
      {viewingPdf && <PdfViewerOverlay manual={viewingPdf} onClose={() => setViewingPdf(null)} />}
    </div>
  );
}
