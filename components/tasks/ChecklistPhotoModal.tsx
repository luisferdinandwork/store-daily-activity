'use client';
// components/tasks/ChecklistPhotoModal.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Reusable modal for capturing photos linked to a checklist item.
//
// Photos are persisted IMMEDIATELY on upload/remove via `onChange` /
// `onChangeMulti`. The parent autosaves them; the modal's "Konfirmasi" button
// only marks the linked checkbox as done once all `min` thresholds are met.
//
// IMPORTANT: emitChange runs in a useEffect that watches `drafts`, NOT inside
// the setState updater. Calling parent setState from within a child setState
// updater triggers React's "Cannot update a component while rendering" warning.
//
// MOBILE NAV:  The fixed bottom nav is h-16 (4rem). The modal footer uses
// pb-[calc(1rem+env(safe-area-inset-bottom))] inside its own padding so that
// on devices with a home indicator the buttons are always reachable.
// The backdrop is always inset-0 so the full screen dims correctly.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react';
import { Camera, X, Loader2, Check, Trash2 } from 'lucide-react';
import { cn }    from '@/lib/utils';
import { toast } from 'sonner';
import CameraCapture from '@/components/shared/CameraCapture';
import { uploadTaskPhoto } from '@/lib/tasks-upload';

// ─── Bucket type (multi-mode) ────────────────────────────────────────────────

export interface PhotoBucket {
  key:           string;
  label:         string;
  hint?:         string;
  photoType:     string;
  min:           number;
  max:           number;
  initialPhotos: string[];
}

// ─── Props (discriminated by `buckets`) ──────────────────────────────────────

type CommonProps = {
  open:         boolean;
  onClose:      () => void;
  title:        string;
  description?: string;
  disabled?:    boolean;
};

type SingleProps = CommonProps & {
  photoType:     string;
  min:           number;
  max:           number;
  initialPhotos: string[];
  onConfirm:     (photos: string[]) => void;
  onClear?:      () => void;
  onChange?:     (photos: string[]) => void;

  buckets?:        undefined;
  onConfirmMulti?: undefined;
  onClearMulti?:   undefined;
  onChangeMulti?:  undefined;
};

type MultiProps = CommonProps & {
  buckets:        PhotoBucket[];
  onConfirmMulti: (results: Record<string, string[]>) => void;
  onClearMulti?:  () => void;
  onChangeMulti?: (results: Record<string, string[]>) => void;

  photoType?:     undefined;
  min?:           undefined;
  max?:           undefined;
  initialPhotos?: undefined;
  onConfirm?:     undefined;
  onClear?:       undefined;
  onChange?:      undefined;
};

export type ChecklistPhotoModalProps = SingleProps | MultiProps;

// ─── Component ───────────────────────────────────────────────────────────────

export default function ChecklistPhotoModal(props: ChecklistPhotoModalProps) {
  const { open, onClose, title, description, disabled } = props;

  const normalizedBuckets: PhotoBucket[] = props.buckets ?? [{
    key:           '__single__',
    label:         '',
    photoType:     props.photoType!,
    min:           props.min!,
    max:           props.max!,
    initialPhotos: props.initialPhotos ?? [],
  }];

  const [drafts, setDrafts] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(normalizedBuckets.map(b => [b.key, b.initialPhotos])),
  );
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);

  // Track whether drafts changed because of user action (vs. an open/reset).
  const userMutatedRef = useRef(false);

  // Reset on open.
  useEffect(() => {
    if (open) {
      userMutatedRef.current = false;
      setDrafts(Object.fromEntries(normalizedBuckets.map(b => [b.key, b.initialPhotos])));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Lock body scroll while open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const isSingle = !props.buckets;

  // Emit drafts to parent in an effect — NEVER inside a setState updater.
  useEffect(() => {
    if (!open) return;
    if (!userMutatedRef.current) return;
    if (isSingle) {
      (props as SingleProps).onChange?.(drafts['__single__'] ?? []);
    } else {
      (props as MultiProps).onChangeMulti?.(drafts);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drafts, open]);

  if (!open) return null;

  async function handleCapture(bucket: PhotoBucket, file: File) {
    if (disabled) return;
    const current = drafts[bucket.key] ?? [];
    if (current.length >= bucket.max) {
      toast.error(`Maksimal ${bucket.max} foto`);
      return;
    }
    setUploadingKey(bucket.key);
    try {
      const url = await uploadTaskPhoto(file, bucket.photoType);
      userMutatedRef.current = true;
      setDrafts(d => ({ ...d, [bucket.key]: [...(d[bucket.key] ?? []), url] }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload gagal');
    } finally {
      setUploadingKey(null);
    }
  }

  function removeAt(bucketKey: string, idx: number) {
    userMutatedRef.current = true;
    setDrafts(d => ({
      ...d,
      [bucketKey]: (d[bucketKey] ?? []).filter((_, i) => i !== idx),
    }));
  }

  const allSatisfied = normalizedBuckets.every(b => (drafts[b.key] ?? []).length >= b.min);
  const hasAnyPhotos = normalizedBuckets.some(b => (drafts[b.key] ?? []).length > 0);

  function handleConfirm() {
    if (!allSatisfied) {
      const first = normalizedBuckets.find(b => (drafts[b.key] ?? []).length < b.min)!;
      toast.error(
        isSingle
          ? `Upload minimal ${first.min} foto terlebih dahulu.`
          : `"${first.label}" butuh minimal ${first.min} foto.`,
      );
      return;
    }
    if (isSingle) {
      (props as SingleProps).onConfirm(drafts['__single__'] ?? []);
    } else {
      (props as MultiProps).onConfirmMulti(drafts);
    }
    onClose();
  }

  function handleClearAll() {
    userMutatedRef.current = true;
    const cleared = Object.fromEntries(normalizedBuckets.map(b => [b.key, [] as string[]]));
    setDrafts(cleared);
    if (isSingle) {
      (props as SingleProps).onClear?.();
    } else {
      (props as MultiProps).onClearMulti?.();
    }
    onClose();
  }

  const hasClearHandler = isSingle
    ? !!(props as SingleProps).onClear
    : !!(props as MultiProps).onClearMulti;

  return (
    // ── Backdrop ────────────────────────────────────────────────────────────
    // Always inset-0 so the full screen dims. The panel itself sits above the
    // nav because the nav is z-50 and the modal is z-[60].
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 sm:items-center"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="checklist-photo-modal-title"
    >
      {/* ── Panel ─────────────────────────────────────────────────────────── */}
      {/* On mobile the sheet rises from the bottom. mb-16 lifts it above the
          h-16 nav bar so the panel never slides under it. On sm+ screens the
          sheet is centred and the nav offset is irrelevant. */}
      <div
        className={cn(
          'relative w-full mx-2 flex flex-col',
          'bg-background shadow-2xl',
          // Mobile: bottom sheet above nav — rounded top corners only
          'rounded-t-3xl max-h-[calc(100dvh-4rem-env(safe-area-inset-bottom))]',
          // sm+: centred modal — fully rounded
          'sm:mb-0 sm:rounded-3xl sm:max-h-[90vh]',
        )}
        onClick={e => e.stopPropagation()}
      >

        {/* Drag handle — mobile affordance */}
        <div className="flex justify-center pt-3 pb-1 sm:hidden" aria-hidden="true">
          <div className="h-1 w-10 rounded-full bg-border" />
        </div>

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0 flex-1">
            <h3
              id="checklist-photo-modal-title"
              className="text-base font-bold text-foreground leading-snug"
            >
              {title}
            </h3>
            {description && (
              <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{description}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground hover:bg-border transition-colors"
            aria-label="Tutup"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ── Scrollable body ─────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {normalizedBuckets.map(bucket => {
            const current   = drafts[bucket.key] ?? [];
            const needed    = Math.max(0, bucket.min - current.length);
            const satisfied = current.length >= bucket.min;
            const uploading = uploadingKey === bucket.key;

            return (
              <BucketSection
                key={bucket.key}
                bucket={bucket}
                current={current}
                needed={needed}
                satisfied={satisfied}
                uploading={uploading}
                disabled={disabled}
                showLabel={!isSingle}
                onCapture={file => handleCapture(bucket, file)}
                onRemove={i => removeAt(bucket.key, i)}
              />
            );
          })}

          {!disabled && hasAnyPhotos && hasClearHandler && (
            <button
              type="button"
              onClick={handleClearAll}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs font-semibold text-red-600 hover:bg-red-100 transition-colors active:scale-[0.98]"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Hapus Semua &amp; Batalkan Checklist
            </button>
          )}
        </div>

        {/* ── Footer actions ───────────────────────────────────────────────── */}
        {/* Extra bottom padding absorbs the device safe-area inset (home bar). */}
        {!disabled && (
          <div className="flex gap-2 border-t border-border px-5 pt-3 pb-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl border border-border bg-card px-4 py-3 text-sm font-semibold text-foreground hover:bg-secondary transition-colors active:scale-[0.98]"
            >
              Tutup
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={!allSatisfied || uploadingKey !== null}
              className={cn(
                'flex-1 flex items-center justify-center gap-1.5 rounded-xl px-4 py-3 text-sm font-bold transition-all active:scale-[0.98]',
                allSatisfied && uploadingKey === null
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-muted-foreground opacity-60 cursor-not-allowed',
              )}
            >
              <Check className="h-4 w-4" strokeWidth={3} />
              Konfirmasi
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Per-bucket section ──────────────────────────────────────────────────────

function BucketSection({
  bucket, current, needed, satisfied, uploading, disabled, showLabel,
  onCapture, onRemove,
}: {
  bucket:    PhotoBucket;
  current:   string[];
  needed:    number;
  satisfied: boolean;
  uploading: boolean;
  disabled?: boolean;
  showLabel: boolean;
  onCapture: (file: File) => void;
  onRemove:  (idx: number) => void;
}) {
  const [cameraOpen, setCameraOpen] = useState(false);

  const countBadge = needed > 0 ? (
    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700 flex-shrink-0">
      Butuh {needed} lagi
    </span>
  ) : (
    <span className="flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-bold text-green-700 flex-shrink-0">
      <Check className="h-3 w-3" strokeWidth={3} />
      Cukup
    </span>
  );

  return (
    <div className="space-y-2.5">
      {/* Section header */}
      {showLabel ? (
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold text-foreground">{bucket.label}</p>
            {bucket.hint && (
              <p className="mt-0.5 text-[10px] text-muted-foreground">{bucket.hint}</p>
            )}
          </div>
          {countBadge}
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold text-foreground">
            {current.length}
            <span className="text-muted-foreground font-normal"> / {bucket.max} foto</span>
            <span className="ml-1 text-[10px] text-muted-foreground font-normal">(min {bucket.min})</span>
          </p>
          {countBadge}
        </div>
      )}

      {/* Photo grid */}
      <div className="grid grid-cols-3 gap-2.5">
        {current.map((url, i) => (
          <div
            key={`${url}-${i}`}
            className="relative aspect-square overflow-hidden rounded-xl border border-border bg-secondary"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={`Foto ${i + 1}`} className="h-full w-full object-cover" />
            {!disabled && (
              <button
                type="button"
                onClick={() => onRemove(i)}
                className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors"
                aria-label={`Hapus foto ${i + 1}`}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
            <div className="absolute bottom-1 left-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[9px] font-bold text-white leading-none">
              {i + 1}
            </div>
          </div>
        ))}

        {/* Add photo cell */}
        {!disabled && current.length < bucket.max && (
          <button
            type="button"
            onClick={() => setCameraOpen(true)}
            disabled={uploading}
            className={cn(
              'flex aspect-square flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed transition-colors',
              'bg-secondary text-muted-foreground',
              'hover:border-primary/40 hover:text-primary hover:bg-primary/5',
              'disabled:opacity-50 disabled:cursor-not-allowed',
              satisfied ? 'border-border' : 'border-amber-300',
            )}
          >
            {uploading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <>
                <Camera className="h-5 w-5" />
                <span className="text-[10px] font-semibold">Tambah</span>
              </>
            )}
          </button>
        )}
      </div>

      {/* Sub-label for multi-bucket mode */}
      {showLabel && (
        <p className="text-[10px] text-muted-foreground">
          {current.length}/{bucket.max} foto · minimal {bucket.min}
        </p>
      )}

      <CameraCapture
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCapture={file => { setCameraOpen(false); onCapture(file); }}
        title={bucket.label || undefined}
      />
    </div>
  );
}