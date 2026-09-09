'use client';
// components/shared/CameraCapture.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Full-screen, camera-only photo capture. This is the ONE way photos get into
// the app — there is no fallback to the OS file/gallery picker, by design.
// It replaces every `<input type="file" capture="environment">` in the tasks,
// petty cash, and issue-report flows.
//
// Flow: live preview → (optional self-timer countdown) → shutter → frozen
// preview (retake / use photo) → onCapture.
//
// Mirroring: the LIVE preview is flipped horizontally whenever the front
// ("user") camera is active — a natural selfie-mirror feel — and this follows
// the camera the user actually switched to, not just the initial prop. The
// SAVED photo is never mirrored (see useCameraCapture.capture()).
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react';
import { CameraOff, Check, Loader2, RotateCcw, SwitchCamera, Timer, TimerOff, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCameraCapture, type CameraFacingMode } from '@/lib/hooks/useCameraCapture';

const TIMER_OPTIONS = [0, 3, 10] as const;

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
  const {
    videoRef, status, error, facingMode: liveFacingMode, start, stop, switchCamera, capture,
  } = useCameraCapture();
  const [preview, setPreview] = useState<{ file: File; url: string } | null>(null);
  const [capturing, setCapturing] = useState(false);

  // Self-timer: seconds to wait after pressing the shutter (0 = off).
  const [timerSec, setTimerSec] = useState<number>(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const countdownTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  function clearCountdown() {
    if (countdownTimer.current) {
      clearInterval(countdownTimer.current);
      countdownTimer.current = null;
    }
    setCountdown(null);
  }

  // Start/stop the stream as the modal opens/closes.
  useEffect(() => {
    if (open) {
      void start(facingMode);
    } else {
      stop();
      clearCountdown();
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

  // Always clear a running countdown interval on unmount.
  useEffect(() => () => {
    if (countdownTimer.current) clearInterval(countdownTimer.current);
  }, []);

  if (!open) return null;

  async function doCapture() {
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

  function handleShutter() {
    if (timerSec <= 0) {
      void doCapture();
      return;
    }
    let remaining = timerSec;
    setCountdown(remaining);
    countdownTimer.current = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearCountdown();
        void doCapture();
      } else {
        setCountdown(remaining);
      }
    }, 1000);
  }

  function cycleTimer() {
    const idx = TIMER_OPTIONS.indexOf(timerSec as (typeof TIMER_OPTIONS)[number]);
    setTimerSec(TIMER_OPTIONS[(idx + 1) % TIMER_OPTIONS.length]);
  }

  function handleRetake() {
    clearCountdown();
    setPreview(p => {
      if (p) URL.revokeObjectURL(p.url);
      return null;
    });
    void start(liveFacingMode);
  }

  function handleUsePhoto() {
    if (!preview) return;
    onCapture(preview.file);
    URL.revokeObjectURL(preview.url);
    setPreview(null);
  }

  function handleClose() {
    clearCountdown();
    stop();
    setPreview(p => {
      if (p) URL.revokeObjectURL(p.url);
      return null;
    });
    onClose();
  }

  const counting = countdown !== null;
  const showCameraControls = status === 'streaming' && !preview && !counting;

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
        {title && <p className="max-w-[45%] truncate text-sm font-semibold text-white">{title}</p>}

        <div className="flex items-center gap-2">
          {showCameraControls && (
            <button
              type="button"
              onClick={cycleTimer}
              aria-label={timerSec === 0 ? 'Aktifkan timer' : `Timer ${timerSec} detik`}
              className={cn(
                'flex h-9 min-w-9 items-center justify-center gap-1 rounded-full px-2 text-white active:scale-95',
                timerSec === 0 ? 'bg-white/10' : 'bg-white/25',
              )}
            >
              {timerSec === 0
                ? <TimerOff className="h-5 w-5" />
                : <><Timer className="h-4 w-4" /><span className="text-xs font-bold">{timerSec}s</span></>}
            </button>
          )}
          {allowSwitchCamera && showCameraControls ? (
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
            className={cn('h-full w-full object-cover', liveFacingMode === 'user' && 'scale-x-[-1]')}
          />
        )}

        {status === 'starting' && !preview && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-white" />
          </div>
        )}

        {/* Self-timer countdown — tap anywhere to cancel */}
        {counting && (
          <button
            type="button"
            onClick={clearCountdown}
            aria-label="Batalkan timer"
            className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/40"
          >
            <span className="flex h-28 w-28 items-center justify-center rounded-full bg-black/50 text-6xl font-bold tabular-nums text-white">
              {countdown}
            </span>
            <span className="text-xs font-semibold text-white/80">Ketuk untuk batal</span>
          </button>
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
            disabled={status !== 'streaming' || capturing || counting}
            aria-label={timerSec > 0 ? `Ambil foto dengan timer ${timerSec} detik` : 'Ambil foto'}
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
