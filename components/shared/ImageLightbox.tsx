'use client';
// components/shared/ImageLightbox.tsx
//
// Full-screen image viewer that opens over the page instead of sending the user
// to a new tab. Close with ✕, Esc or a click outside the image; ← / → (or the
// arrows / thumbnails) step through a set. Portaled to <body> so it isn't
// trapped by a transformed / overflow-hidden ancestor (the issue drawers slide
// in with a transform, which would otherwise clip a `fixed` child), and its Esc
// is caught before a drawer's own Esc handler, so only the viewer closes.

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, ExternalLink, ImageOff, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface LightboxImage {
  url: string;
  /** Caption, e.g. "Photo" or "Berita Acara". */
  label?: string;
}

export function ImageLightbox({
  images,
  index,
  onIndexChange,
  onClose,
  title,
}: {
  images: LightboxImage[];
  index: number;
  onIndexChange: (i: number) => void;
  onClose: () => void;
  /** Shown top-left, e.g. the issue title. */
  title?: string;
}) {
  const count = images.length;
  const [broken, setBroken] = useState<Set<string>>(() => new Set());

  const go = useCallback(
    (dir: number) => { if (count > 1) onIndexChange((index + dir + count) % count); },
    [count, index, onIndexChange],
  );

  // Capture phase + stopPropagation: Esc closes the viewer only, not the
  // drawer underneath it that listens for Esc too.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
      else if (e.key === 'ArrowLeft') { e.stopPropagation(); go(-1); }
      else if (e.key === 'ArrowRight') { e.stopPropagation(); go(1); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [go, onClose]);

  // No page scroll behind the viewer.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const image = images[index];
  if (!image || typeof document === 'undefined') return null;
  const isBroken = broken.has(image.url);

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex flex-col bg-black/90 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={image.label ?? title ?? 'Image preview'}
    >
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-3 text-white" onClick={(e) => e.stopPropagation()}>
        <div className="min-w-0 flex-1">
          {title && <p className="truncate text-sm font-medium">{title}</p>}
          <p className="text-xs text-white/60">
            {image.label ?? 'Image'}
            {count > 1 && <span className="ml-1.5 tabular-nums">{index + 1} / {count}</span>}
          </p>
        </div>
        <a
          href={image.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs text-white/70 transition-colors hover:bg-white/10 hover:text-white"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Open original
        </a>
        <button
          type="button"
          onClick={onClose}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 transition-colors hover:bg-white/20"
          aria-label="Close preview"
          autoFocus
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Image */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-14 pb-4">
        {count > 1 && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); go(-1); }}
            className="absolute left-3 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
            aria-label="Previous image"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        )}

        {isBroken ? (
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex h-64 w-80 max-w-full flex-col items-center justify-center gap-2 rounded-lg bg-white/5 text-white/60"
          >
            <ImageOff className="h-8 w-8" />
            <p className="text-sm">Image unavailable</p>
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={image.url}
            src={image.url}
            alt={image.label ?? 'Image'}
            onClick={(e) => e.stopPropagation()}
            onError={() => setBroken((prev) => new Set(prev).add(image.url))}
            className="max-h-full max-w-full rounded-md object-contain shadow-2xl"
          />
        )}

        {count > 1 && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); go(1); }}
            className="absolute right-3 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
            aria-label="Next image"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* Thumbnails */}
      {count > 1 && (
        <div className="flex justify-center gap-2 overflow-x-auto px-4 pb-4" onClick={(e) => e.stopPropagation()}>
          {images.map((img, i) => (
            <button
              key={`${img.url}-${i}`}
              type="button"
              onClick={() => onIndexChange(i)}
              className={cn(
                'h-12 w-12 shrink-0 overflow-hidden rounded-md border-2 transition-opacity',
                i === index ? 'border-white opacity-100' : 'border-transparent opacity-50 hover:opacity-80',
              )}
              aria-label={`Show image ${i + 1}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.url} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>,
    document.body,
  );
}
