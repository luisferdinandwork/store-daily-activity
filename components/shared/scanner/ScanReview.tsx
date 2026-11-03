'use client';
// components/shared/scanner/ScanReview.tsx
// After the shutter: the flattened, cleaned-up scan with one-tap filters, a
// 90° rotate and a corner editor for when the auto-crop missed. "Gunakan" hands
// back a JPEG File exactly like CameraCapture does.

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, Crop, Loader2, RotateCcw, RotateCw, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { Quad, Raster, ScanFilter } from '@/lib/scanner/types';
import { SCAN_FILTER_LABEL } from '@/lib/scanner/types';
import { fullFrameQuad } from '@/lib/scanner/geometry';
import { rotateRaster, scanOutputSize, warpQuad } from '@/lib/scanner/warp';
import { enhanceRaster } from '@/lib/scanner/enhance';
import { canvasToJpegFile, canvasToRaster, rasterToCanvas } from '@/lib/scanner/frame';
import CornerEditor from './CornerEditor';

const FILTERS: ScanFilter[] = ['document', 'color', 'original'];
const nextFrame = () => new Promise<void>(resolve => setTimeout(resolve, 0));

interface ScanReviewProps {
  /** The captured frame. */
  source: HTMLCanvasElement;
  /** Detected corners in source pixels, or null when nothing was found. */
  initialQuad: Quad | null;
  title?: string;
  onRetake: () => void;
  onClose: () => void;
  onUse: (file: File) => void;
}

interface Result { file: File; url: string }

export default function ScanReview({ source, initialQuad, title, onRetake, onClose, onUse }: ScanReviewProps) {
  const detected = initialQuad !== null;
  const [corners, setCorners] = useState<Quad>(() => initialQuad ?? fullFrameQuad(source.width, source.height));
  const [filter, setFilter] = useState<ScanFilter>('document');
  const [turns, setTurns] = useState(0);
  const [editing, setEditing] = useState(false);
  const [processing, setProcessing] = useState(true);
  const [result, setResult] = useState<Result | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);

  const runId = useRef(0);
  const resultUrl = useRef<string | null>(null);
  const sourceRaster = useRef<Raster | null>(null);
  const flatCache = useRef<{ key: string; flat: Raster } | null>(null);

  /** Makes any in-flight `process` run discard its result. */
  function cancelPending() { runId.current++; }
  function releaseResult() {
    if (resultUrl.current) URL.revokeObjectURL(resultUrl.current);
    resultUrl.current = null;
  }

  const process = useCallback(async (c: Quad, f: ScanFilter, t: number) => {
    const id = ++runId.current;
    setProcessing(true);
    await nextFrame(); // let the spinner paint before the heavy part
    try {
      sourceRaster.current ??= canvasToRaster(source);
      const key = c.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('|');
      let flat = flatCache.current?.key === key ? flatCache.current.flat : null;
      if (!flat) {
        const size = scanOutputSize(c);
        flat = warpQuad(sourceRaster.current, c, size.width, size.height);
        flatCache.current = { key, flat };
      }
      await nextFrame();
      if (id !== runId.current) return;
      const out = rotateRaster(enhanceRaster(flat, f), t);
      const file = await canvasToJpegFile(rasterToCanvas(out), 'scan');
      if (id !== runId.current) return;
      if (!file) throw new Error('encode');
      if (resultUrl.current) URL.revokeObjectURL(resultUrl.current);
      resultUrl.current = URL.createObjectURL(file);
      setResult({ file, url: resultUrl.current });
    } catch {
      if (id === runId.current) toast.error('Gagal memproses gambar. Coba ambil ulang.');
    } finally {
      if (id === runId.current) setProcessing(false);
    }
  }, [source]);

  // First pass + the picture the corner editor draws on.
  useEffect(() => {
    const first = setTimeout(() => void process(corners, filter, turns), 0);
    let url: string | null = null;
    let cancelled = false;
    source.toBlob(blob => {
      if (!blob || cancelled) return;
      url = URL.createObjectURL(blob);
      setSourceUrl(url);
    }, 'image/jpeg', 0.85);
    return () => {
      clearTimeout(first);
      cancelled = true;
      cancelPending();
      if (url) URL.revokeObjectURL(url);
      releaseResult();
    };
    // Runs once per captured frame; later changes go through the handlers below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  function changeFilter(f: ScanFilter) {
    if (f === filter) return;
    setFilter(f);
    void process(corners, f, turns);
  }

  function rotate() {
    const t = (turns + 1) % 4;
    setTurns(t);
    void process(corners, filter, t);
  }

  function applyCorners() {
    setEditing(false);
    void process(corners, filter, turns);
  }

  function resetCorners() {
    setCorners(initialQuad ?? fullFrameQuad(source.width, source.height));
  }

  const busy = processing && !editing;

  return (
    <div
      className="fixed inset-0 z-[71] flex flex-col bg-black landscape:flex-row"
      role="dialog"
      aria-modal="true"
      aria-label={title ? `Hasil pindai: ${title}` : 'Hasil pindai'}
    >
      {/* Header */}
      <div
        className={cn(
          'flex items-center justify-between gap-2 px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))]',
          'landscape:h-full landscape:w-16 landscape:flex-col landscape:justify-start landscape:gap-4',
          'landscape:px-0 landscape:pl-[env(safe-area-inset-left)]',
        )}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Tutup"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-white active:scale-95"
        >
          <X className="h-5 w-5" />
        </button>
        <p className="min-w-0 flex-1 truncate text-center text-sm font-semibold text-white landscape:max-w-[56px] landscape:flex-none landscape:line-clamp-4 landscape:whitespace-normal landscape:break-words landscape:text-[10px] landscape:leading-tight">
          {editing ? 'Atur sudut dokumen' : (title ?? 'Hasil pindai')}
        </p>
        {editing ? (
          <button
            type="button"
            onClick={resetCorners}
            className="rounded-full bg-white/10 px-3 py-2 text-[11px] font-bold text-white active:scale-95"
          >
            Reset
          </button>
        ) : (
          <div className="flex items-center gap-2 landscape:flex-col">
            <button
              type="button"
              onClick={rotate}
              aria-label="Putar 90 derajat"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white active:scale-95"
            >
              <RotateCw className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => setEditing(true)}
              aria-label="Atur sudut"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white active:scale-95"
            >
              <Crop className="h-5 w-5" />
            </button>
          </div>
        )}
      </div>

      {/* Viewport */}
      <div className="relative flex-1 overflow-hidden bg-neutral-900">
        {editing ? (
          sourceUrl
            ? <CornerEditor imageUrl={sourceUrl} width={source.width} height={source.height} corners={corners} onChange={setCorners} />
            : <div className="flex h-full items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-white" /></div>
        ) : (
          <>
            {result && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={result.url} alt="Hasil pindai" className="h-full w-full object-contain" />
            )}
            {busy && (
              <div className={cn('absolute inset-0 flex items-center justify-center', result && 'bg-black/40')}>
                <Loader2 className="h-8 w-8 animate-spin text-white" />
              </div>
            )}
            {!detected && !busy && (
              <div className="absolute inset-x-3 top-3 flex items-start gap-2 rounded-xl bg-amber-500/95 px-3 py-2 text-[11px] font-semibold leading-snug text-black">
                <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
                <span>Tepi dokumen tidak terdeteksi, seluruh foto dipakai. Ketuk ikon potong untuk mengatur sudut, atau ambil ulang.</span>
              </div>
            )}
          </>
        )}
      </div>

      {/* Controls */}
      <div
        className={cn(
          'flex flex-col gap-3 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3',
          'landscape:h-full landscape:w-44 landscape:justify-center landscape:px-3 landscape:py-4 landscape:pr-[calc(0.75rem+env(safe-area-inset-right))]',
        )}
      >
        {editing ? (
          <button
            type="button"
            onClick={applyCorners}
            className="flex h-12 w-full items-center justify-center gap-1.5 rounded-full bg-white text-xs font-bold text-black active:scale-[0.98]"
          >
            <Check className="h-4 w-4" strokeWidth={3} />
            Terapkan
          </button>
        ) : (
          <>
            <div className="flex rounded-full bg-white/10 p-1 landscape:flex-col landscape:rounded-2xl">
              {FILTERS.map(f => (
                <button
                  key={f}
                  type="button"
                  onClick={() => changeFilter(f)}
                  aria-pressed={filter === f}
                  className={cn(
                    'flex-1 rounded-full px-3 py-2 text-xs font-bold transition-colors landscape:rounded-xl',
                    filter === f ? 'bg-white text-black' : 'text-white/80',
                  )}
                >
                  {SCAN_FILTER_LABEL[f]}
                </button>
              ))}
            </div>
            <div className="flex gap-3 landscape:flex-col">
              <button
                type="button"
                onClick={onRetake}
                className="flex h-12 flex-1 items-center justify-center gap-1.5 rounded-full border border-white/30 text-xs font-bold text-white active:scale-[0.98]"
              >
                <RotateCcw className="h-4 w-4" />
                Ambil Ulang
              </button>
              <button
                type="button"
                onClick={() => result && onUse(result.file)}
                disabled={!result || busy}
                className="flex h-12 flex-1 items-center justify-center gap-1.5 rounded-full bg-white text-xs font-bold text-black active:scale-[0.98] disabled:opacity-50"
              >
                <Check className="h-4 w-4" strokeWidth={3} />
                Gunakan
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
