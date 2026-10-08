'use client';
// components/shared/IssueAttachments.tsx
//
// The "Photos" and "Berita Acara" sections of an issue drawer, shared by the
// Ops, Finance, Audit and IT issue pages. Images open in ImageLightbox (close
// with ✕ / Esc / a click outside) instead of a new tab; a Berita Acara that
// isn't an image (PDF, Word, Excel) still opens as a file.

import { useState } from 'react';
import { FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ImageLightbox, type LightboxImage } from '@/components/shared/ImageLightbox';

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|heic|heif|avif|bmp)$/i;

function isImageUrl(url: string): boolean {
  return IMAGE_EXT.test(url.split(/[?#]/)[0]);
}

function fileExt(url: string): string {
  return url.split(/[?#]/)[0].split('.').pop()?.toUpperCase() ?? 'FILE';
}

export function IssueAttachments({
  title,
  attachmentUrls,
  baAttachmentUrls,
  baUploadedLabel,
  compact = false,
  hoverClass = 'hover:border-slate-400',
}: {
  /** Issue title, shown in the viewer. */
  title: string;
  attachmentUrls: string[];
  baAttachmentUrls: string[];
  /** e.g. "Uploaded 2h ago" — shown under the Berita Acara grid. */
  baUploadedLabel?: string | null;
  /** IT's dense layout: 4 columns, small headings. */
  compact?: boolean;
  /** Panel accent on thumbnail hover, e.g. "hover:border-indigo-300". */
  hoverClass?: string;
}) {
  const [viewer, setViewer] = useState<{ images: LightboxImage[]; index: number } | null>(null);

  const photos: LightboxImage[] = attachmentUrls.map((url) => ({ url, label: 'Photo' }));
  const baImages: LightboxImage[] = baAttachmentUrls.filter(isImageUrl).map((url) => ({ url, label: 'Berita Acara' }));

  const heading = compact
    ? 'mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500'
    : 'mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400';
  const grid = cn('grid', compact ? 'grid-cols-4 gap-1.5' : 'grid-cols-3 gap-2');
  const tile = cn(
    'group relative block aspect-square overflow-hidden border bg-slate-100 transition-all hover:shadow-sm',
    compact ? 'rounded-md border-slate-200' : 'rounded-xl border-slate-200',
    hoverClass,
  );

  if (!attachmentUrls.length && !baAttachmentUrls.length) return null;

  return (
    <>
      {attachmentUrls.length > 0 && (
        <div>
          <p className={heading}>Photos ({attachmentUrls.length})</p>
          <div className={grid}>
            {attachmentUrls.map((url, i) => (
              <button
                key={`${url}-${i}`}
                type="button"
                onClick={() => setViewer({ images: photos, index: i })}
                className={tile}
                aria-label={`Preview photo ${i + 1}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt={`Attachment ${i + 1}`} className="h-full w-full object-cover transition-transform group-hover:scale-105" />
              </button>
            ))}
          </div>
        </div>
      )}

      {baAttachmentUrls.length > 0 && (
        <div>
          <p className={heading}>Berita Acara ({baAttachmentUrls.length})</p>
          <div className={grid}>
            {baAttachmentUrls.map((url, i) =>
              isImageUrl(url) ? (
                <button
                  key={`${url}-${i}`}
                  type="button"
                  onClick={() => setViewer({ images: baImages, index: baImages.findIndex((b) => b.url === url) })}
                  className={cn(tile, 'border-violet-200 hover:border-violet-300')}
                  aria-label={`Preview Berita Acara ${i + 1}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt={`Berita Acara ${i + 1}`} className="h-full w-full object-cover transition-transform group-hover:scale-105" />
                </button>
              ) : (
                <a
                  key={`${url}-${i}`}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(tile, 'border-violet-200 hover:border-violet-300')}
                  title="Open file"
                >
                  <span className="flex h-full w-full flex-col items-center justify-center gap-1 bg-violet-50 px-1 text-center">
                    <FileText className={cn('text-violet-500', compact ? 'h-5 w-5' : 'h-6 w-6')} />
                    <span className="text-[10px] font-bold text-violet-600">{fileExt(url)}</span>
                  </span>
                </a>
              ),
            )}
          </div>
          {baUploadedLabel && (
            <p className="mt-1.5 text-[11px] text-slate-400">{baUploadedLabel}</p>
          )}
        </div>
      )}

      {viewer && (
        <ImageLightbox
          title={title}
          images={viewer.images}
          index={viewer.index}
          onIndexChange={(index) => setViewer((v) => (v ? { ...v, index } : v))}
          onClose={() => setViewer(null)}
        />
      )}
    </>
  );
}
