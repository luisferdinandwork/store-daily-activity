'use client';
// components/shared/CameraCapture.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Full-screen, camera-only photo capture. This is the ONE way photos get into
// the app — there is no fallback to the OS file/gallery picker, by design.
// It replaces every `<input type="file" capture="environment">` in the tasks,
// petty cash, and issue-report flows.
//
// Flow: live preview → shutter → frozen preview (retake / use photo) → onCapture.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react';
import { CameraOff, Check, Loader2, RotateCcw, SwitchCamera, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCameraCapture, type CameraFacingMode } from '@/lib/hooks/useCameraCapture';

interface CameraCaptureProps {
  open: boolean;
  onClose: () => void;
  onCapture: (file: File) => void;
  facingMode?: CameraFacingMode;
  allowSwitchCamera?: boolean;
  title?: string;
}

export default function CameraCapture({
  open, onClose, onCapture, facingMode = 'environment', allowSwitchCamera = true, title,
}: CameraCaptureProps) {
  const { videoRef, status, error, start, stop, switchCamera, capture } = useCameraCapture();
  const [preview, setPreview] = useState<{ file: File; url: string } | null>(null);
  const [capturing, setCapturing] = useState(false);

  // Start/stop the stream as the modal opens/closes.
  useEffect(() => {
    if (open) {
      void start(facingMode);
    } else {
      stop();
      setPreview(p => {
        if (p) URL.revokeObjectURL(p.url);
        return null;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Lock body scroll while open, same as ChecklistPhotoModal.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open) return null;

  async function handleShutter() {
    setCapturing(true);
    try {
      const file = await capture();
      if (file) {
        setPreview({ file, url: URL.createObjectURL(file) });
        stop();
      }
    } finally {
      setCapturing(false);
    }
  }

  function handleRetake() {
    setPreview(p => {
      if (p) URL.revokeObjectURL(p.url);
      return null;
    });
    void start(facingMode);
  }

  function handleUsePhoto() {
    if (!preview) return;
    onCapture(preview.file);
    URL.revokeObjectURL(preview.url);
    setPreview(null);
  }

  function handleClose() {
    stop();
    setPreview(p => {
      if (p) URL.revokeObjectURL(p.url);
      return null;
    });
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex flex-col bg-black"
      role="dialog"
      aria-modal="true"
      aria-label={title ?? 'Ambil foto'}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))]">
        <button
          type="button"
          onClick={handleClose}
          aria-label="Tutup kamera"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white active:scale-95"
        >
          <X className="h-5 w-5" />
        </button>
        {title && <p className="max-w-[60%] truncate text-sm font-semibold text-white">{title}</p>}
        {allowSwitchCamera && status === 'streaming' && !preview ? (
          <button
            type="button"
            onClick={switchCamera}
            aria-label="Ganti kamera"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white active:scale-95"
          >
            <SwitchCamera className="h-5 w-5" />
          </button>
        ) : (
          <div className="h-9 w-9" aria-hidden="true" />
        )}
      </div>

      {/* Viewport */}
      <div className="relative flex-1 overflow-hidden bg-black">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview.url} alt="Hasil foto" className="h-full w-full object-contain" />
        ) : (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={cn('h-full w-full object-cover', facingMode === 'user' && 'scale-x-[-1]')}
          />
        )}

        {status === 'starting' && !preview && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-white" />
          </div>
        )}

        {status === 'error' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center">
            <CameraOff className="h-10 w-10 text-white/70" />
            <p className="text-sm text-white/90">{error}</p>
            <button
              type="button"
              onClick={() => start(facingMode)}
              className="rounded-xl bg-white px-4 py-2 text-xs font-bold text-black active:scale-95"
            >
              Coba lagi
            </button>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center justify-center gap-4 px-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-4">
        {preview ? (
          <>
            <button
              type="button"
              onClick={handleRetake}
              className="flex h-12 flex-1 max-w-[160px] items-center justify-center gap-1.5 rounded-full border border-white/30 text-xs font-bold text-white active:scale-[0.98]"
            >
              <RotateCcw className="h-4 w-4" />
              Ambil Ulang
            </button>
            <button
              type="button"
              onClick={handleUsePhoto}
              className="flex h-12 flex-1 max-w-[200px] items-center justify-center gap-1.5 rounded-full bg-white text-xs font-bold text-black active:scale-[0.98]"
            >
              <Check className="h-4 w-4" strokeWidth={3} />
              Gunakan Foto
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={handleShutter}
            disabled={status !== 'streaming' || capturing}
            aria-label="Ambil foto"
            className="flex h-16 w-16 items-center justify-center rounded-full border-4 border-white/80 disabled:opacity-40"
          >
            {capturing
              ? <Loader2 className="h-6 w-6 animate-spin text-white" />
              : <span className="h-12 w-12 rounded-full bg-white" />}
          </button>
        )}
      </div>
    </div>
  );
}
