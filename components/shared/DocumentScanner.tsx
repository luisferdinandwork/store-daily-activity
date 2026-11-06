'use client';
// components/shared/DocumentScanner.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Camera-only DOCUMENT scanner — a drop-in for CameraCapture (same props, hands
// back a JPEG File) for finance paperwork: transfer slips (resi), Z-Report / EDC
// settlement strips, petty-cash receipts, sales-return receipts.
//
// The scanning itself is a switch in the camera ("Dokumen"), OFF each time it opens:
// off = a plain photo (shutter only, no outline / auto-capture / flatten / filters);
// on = everything described below.
//
// Live: the rear camera runs with continuous autofocus; every ~120 ms a small
// copy of the frame is searched for the sheet (lib/scanner/detect.ts) and its
// outline is drawn over the video. When the sheet has held still AND the focus
// has stopped improving, it captures by itself (Auto can be switched off — the
// shutter is always there). The shutter grabs a short burst and keeps the
// sharpest frame. Tap the picture to refocus; the torch helps in a dim store.
//
// Review (ScanReview): the sheet is flattened out of perspective and the
// lighting evened out so print is dark on white; filters, rotate and manual
// corners are one tap away.
//
// Photos that are NOT paper (selfie with ATM card, storefront, cash) should keep
// using CameraCapture.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CameraOff, Flashlight, FlashlightOff, Loader2, ScanLine, X, Zap, ZapOff,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useScannerCamera } from '@/lib/hooks/useScannerCamera';
import { detectDocument, frameStats, sharpness, toGray } from '@/lib/scanner/detect';
import { QuadTracker } from '@/lib/scanner/tracker';
import { clampQuad, expandQuad, quadArea, scaleQuad } from '@/lib/scanner/geometry';
import { createScratch, focusRegion, sampleRaster } from '@/lib/scanner/frame';
import type { Quad } from '@/lib/scanner/types';
import CameraCapture from '@/components/shared/CameraCapture';
import ScanReview from '@/components/shared/scanner/ScanReview';

/** Long edge of the copy the detector looks at while live. */
const LIVE_EDGE = 256;
/** …and for the final, more exact pass on the captured frame. */
const FINAL_EDGE = 512;
/** Target gap between analysis passes. */
const TICK_MS = 120;
/** How long the sheet must hold still before Auto fires. */
const AUTO_HOLD_MS = 1000;
/** Auto never fires on a speck: the sheet must cover at least this share of the frame. */
const MIN_AUTO_AREA = 0.18;
const MIN_BRIGHTNESS = 55;
const BURST = 3;

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

interface LiveView {
  quad: Quad | null;
  /** Video frame size, so the overlay can share the video's letterboxing. */
  vw: number;
  vh: number;
  /** 0..1 progress toward the automatic capture. */
  progress: number;
  tone: 'none' | 'far' | 'found' | 'locked';
  hint: string;
}

const IDLE_VIEW: LiveView = {
  quad: null, vw: 16, vh: 9, progress: 0, tone: 'none', hint: 'Arahkan kamera ke dokumen',
};

/** `doc` = the scanner was on when it was shot (decides how the review treats it). */
interface Shot { canvas: HTMLCanvasElement; quad: Quad | null; doc: boolean }

const PLAIN_VIEW: LiveView = { ...IDLE_VIEW, hint: 'Ketuk tombol untuk mengambil foto' };

export interface DocumentScannerProps {
  open: boolean;
  onClose: () => void;
  onCapture: (file: File) => void;
  title?: string;
}

export default function DocumentScanner(props: DocumentScannerProps) {
  // The session mounts only while open, so the camera's lifetime is the component's lifetime.
  return props.open ? <ScannerSession {...props} /> : null;
}

function ScannerSession({ onClose, onCapture, title }: DocumentScannerProps) {
  const {
    videoRef, status, error, torchSupported, torchOn, start, stop, setTorch, refocus, grabFrame,
  } = useScannerCamera();

  const [phase, setPhase] = useState<'live' | 'review'>('live');
  const [view, setView] = useState<LiveView>(IDLE_VIEW);
  // Document scanning (outline, auto-capture, flatten + clean-up) is OFF each time the camera
  // opens: it takes a plain photo until the user switches "Dokumen" on.
  const [docOn, setDocOn] = useState(false);
  const [autoOn, setAutoOn] = useState(true);
  const [shooting, setShooting] = useState(false);
  const [shot, setShot] = useState<Shot | null>(null);
  const [tap, setTap] = useState<{ x: number; y: number; k: number } | null>(null);
  const [plainCamera, setPlainCamera] = useState(false);

  /** Last quad the live loop is tracking (0..1 of the frame) — aims the shutter burst. */
  const lastQuad = useRef<Quad | null>(null);
  const shootingRef = useRef(false);
  const autoRef = useRef(true);
  const docRef = useRef(false);
  const shootRef = useRef<() => void>(() => {});
  const viewportRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { autoRef.current = autoOn; }, [autoOn]);
  useEffect(() => { docRef.current = docOn; }, [docOn]);

  // Start the camera once; lock page scroll behind the full-screen view.
  useEffect(() => {
    void start();
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [start]);

  const shoot = useCallback(async () => {
    if (shootingRef.current) return;
    shootingRef.current = true;
    setShooting(true);
    try {
      const doc = docRef.current;
      const scratch = createScratch();
      const tracked = doc ? lastQuad.current : null;
      const region = focusRegion(tracked);

      // A short burst: keep whichever frame is sharpest (handheld shake, late autofocus).
      let best: { canvas: HTMLCanvasElement; score: number } | null = null;
      for (let i = 0; i < BURST; i++) {
        const canvas = grabFrame();
        if (!canvas) break;
        const probe = sampleRaster(canvas, canvas.width, canvas.height, 640, scratch, region);
        const score = probe ? sharpness(probe) : 0;
        if (!best || score > best.score) best = { canvas, score };
        if (i < BURST - 1) await sleep(80);
      }
      if (!best) {
        toast.error('Gagal mengambil gambar. Coba lagi.');
        return;
      }

      // Exact outline from the chosen frame; fall back to what the user saw on screen.
      // (Scanner off: a plain photo, nothing is searched for.)
      const { canvas } = best;
      let quad: Quad | null = null;
      if (doc) {
        const fine = sampleRaster(canvas, canvas.width, canvas.height, FINAL_EDGE, scratch);
        const found = (fine ? detectDocument(fine)?.quad : null) ?? tracked;
        quad = found
          ? clampQuad(expandQuad(scaleQuad(found, canvas.width, canvas.height), 1.004), canvas.width, canvas.height)
          : null;
      }

      stop();
      setShot({ canvas, quad, doc });
      setPhase('review');
    } finally {
      shootingRef.current = false;
      setShooting(false);
    }
  }, [grabFrame, stop]);

  useEffect(() => { shootRef.current = () => void shoot(); }, [shoot]);

  // ── live analysis loop ────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'live' || status !== 'streaming') return;
    const video = videoRef.current;
    if (!video) return;

    // Scanner off: nothing to analyse — no outline, no auto-capture, no CPU spent.
    if (!docOn) {
      lastQuad.current = null;
      setView(PLAIN_VIEW);
      return;
    }

    const scratch = createScratch();
    const probeCanvas = createScratch();
    const tracker = new QuadTracker();
    lastQuad.current = null;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    let peakSharp = 0;

    const tick = () => {
      if (!alive) return;
      const t0 = performance.now();
      const vw = video.videoWidth;
      const vh = video.videoHeight;

      if (vw && vh && video.readyState >= 2 && !shootingRef.current) {
        const frame = sampleRaster(video, vw, vh, LIVE_EDGE, scratch);
        if (frame) {
          const found = detectDocument(frame);
          const st = tracker.update(found?.quad ?? null, t0);
          lastQuad.current = st.quad;
          const dark = frameStats(toGray(frame)).brightness < MIN_BRIGHTNESS;

          let next: LiveView;
          if (!st.quad) {
            peakSharp = 0;
            next = {
              quad: null, vw, vh, progress: 0, tone: 'none',
              hint: dark
                ? (torchSupported ? 'Kurang terang — nyalakan lampu' : 'Kurang terang — cari tempat lebih terang')
                : 'Arahkan kamera ke dokumen',
            };
          } else {
            const area = quadArea(st.quad); // corners are 0..1, so this is the share of the frame
            const probe = sampleRaster(video, vw, vh, 480, probeCanvas, focusRegion(st.quad));
            const sharp = probe ? sharpness(probe) : 0;
            if (st.stableMs < 60) peakSharp = 0;
            peakSharp = Math.max(peakSharp, sharp);
            // "Settled": focus has stopped improving (it only ever rises while the lens is hunting).
            const focused = peakSharp === 0 || sharp >= peakSharp * 0.85;
            const big = area >= MIN_AUTO_AREA;
            const still = st.stableMs >= 350;

            let hint: string;
            let tone: LiveView['tone'];
            if (!big) { tone = 'far'; hint = 'Dekatkan kamera ke dokumen'; }
            else if (!still) { tone = 'found'; hint = 'Dokumen terdeteksi — tahan stabil'; }
            else if (!focused) { tone = 'found'; hint = 'Menunggu fokus…'; }
            else { tone = 'locked'; hint = autoRef.current ? 'Tahan… jangan bergerak' : 'Siap — ketuk tombol untuk memindai'; }

            const progress = autoRef.current && big && focused ? Math.min(1, st.stableMs / AUTO_HOLD_MS) : 0;
            next = { quad: st.quad, vw, vh, progress, tone, hint };

            if (autoRef.current && !st.held && big && focused && st.stableMs >= AUTO_HOLD_MS) {
              setView(next);
              shootRef.current();
              return; // the shot (and the phase change) takes it from here
            }
          }
          setView(next);
        }
      }
      // On a slow phone the pass itself can exceed TICK_MS: always leave the UI thread a gap.
      timer = setTimeout(tick, Math.max(60, TICK_MS - (performance.now() - t0)));
    };
    tick();

    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [phase, status, videoRef, torchSupported, docOn]);

  function handleRetake() {
    lastQuad.current = null;
    setShot(null);
    setView(docOn ? IDLE_VIEW : PLAIN_VIEW);
    setPhase('live');
    void start();
  }

  function handleClose() {
    stop();
    onClose();
  }

  /** Tap the picture → refocus there. */
  function handleTapFocus(e: React.MouseEvent<HTMLDivElement>) {
    const el = viewportRef.current;
    if (!el || status !== 'streaming') return;
    const rect = el.getBoundingClientRect();
    const va = view.vw / view.vh;
    const ca = rect.width / rect.height;
    const cw = va > ca ? rect.width : rect.height * va;
    const ch = va > ca ? rect.width / va : rect.height;
    const nx = (e.clientX - (rect.left + (rect.width - cw) / 2)) / cw;
    const ny = (e.clientY - (rect.top + (rect.height - ch) / 2)) / ch;
    setTap({ x: e.clientX - rect.left, y: e.clientY - rect.top, k: Date.now() });
    if (nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1) void refocus({ x: nx, y: ny });
    else void refocus();
  }

  // Camera unusable → offer the plain photo camera rather than a dead end.
  if (plainCamera) {
    return <CameraCapture open onClose={onClose} onCapture={onCapture} title={title} />;
  }

  const ready = status === 'streaming';
  const toneColor =
    view.tone === 'locked' ? '#22c55e'
      : view.tone === 'far' ? '#f59e0b'
        : '#ffffff';
  const ringLen = 2 * Math.PI * 30;

  return (
    <>
      <div
        className="fixed inset-0 z-[70] flex flex-col bg-black landscape:flex-row"
        role="dialog"
        aria-modal="true"
        aria-label={title ? `Pindai: ${title}` : 'Pindai dokumen'}
      >
        {/* Header — top bar in portrait, left rail in landscape */}
        <div
          className={cn(
            'flex items-center justify-between gap-2 px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))]',
            'landscape:h-full landscape:w-16 landscape:flex-col landscape:justify-start landscape:gap-4',
            'landscape:px-0 landscape:pl-[env(safe-area-inset-left)]',
          )}
        >
          <button
            type="button"
            onClick={handleClose}
            aria-label="Tutup kamera"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-white active:scale-95"
          >
            <X className="h-5 w-5" />
          </button>
          <p className="flex min-w-0 flex-1 items-center justify-center gap-1.5 text-sm font-semibold text-white landscape:max-w-[56px] landscape:flex-none landscape:flex-col landscape:gap-1 landscape:text-[10px] landscape:leading-tight">
            <ScanLine className="h-4 w-4 shrink-0 text-white/70" />
            <span className="truncate landscape:line-clamp-4 landscape:whitespace-normal landscape:break-words landscape:text-center">
              {title ?? 'Pindai dokumen'}
            </span>
          </p>
          {torchSupported && ready ? (
            <button
              type="button"
              onClick={() => void setTorch(!torchOn)}
              aria-label={torchOn ? 'Matikan lampu' : 'Nyalakan lampu'}
              aria-pressed={torchOn}
              className={cn(
                'flex h-9 w-9 items-center justify-center rounded-full text-white active:scale-95',
                torchOn ? 'bg-amber-500' : 'bg-white/10',
              )}
            >
              {torchOn ? <Flashlight className="h-5 w-5" /> : <FlashlightOff className="h-5 w-5" />}
            </button>
          ) : (
            <div className="h-9 w-9 shrink-0" aria-hidden="true" />
          )}
        </div>

        {/* Viewport */}
        <div
          ref={viewportRef}
          onClick={handleTapFocus}
          className="relative flex-1 overflow-hidden bg-black"
        >
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="h-full w-full object-contain"
          />

          {/* Document outline — shares the video's letterboxing via the same viewBox */}
          {ready && view.quad && (
            <svg
              viewBox={`0 0 ${view.vw} ${view.vh}`}
              preserveAspectRatio="xMidYMid meet"
              className="pointer-events-none absolute inset-0 h-full w-full"
              aria-hidden="true"
            >
              <polygon
                points={view.quad.map(p => `${p.x * view.vw},${p.y * view.vh}`).join(' ')}
                fill={toneColor}
                fillOpacity={0.08 + 0.14 * view.progress}
                stroke={toneColor}
                strokeWidth={3}
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
              {view.quad.map((p, i) => (
                <circle key={i} cx={p.x * view.vw} cy={p.y * view.vh} r={view.vw * 0.008} fill={toneColor} />
              ))}
            </svg>
          )}

          {/* Guide when nothing is tracked yet */}
          {ready && docOn && !view.quad && (
            <div className="pointer-events-none absolute inset-[10%] rounded-2xl border-2 border-dashed border-white/35" />
          )}

          {/* Hint pill */}
          {ready && (
            <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center px-4">
              <span
                className={cn(
                  'rounded-full px-3 py-1.5 text-xs font-semibold text-white backdrop-blur',
                  view.tone === 'locked' ? 'bg-emerald-600/85' : view.tone === 'far' ? 'bg-amber-600/85' : 'bg-black/60',
                )}
              >
                {view.hint}
              </span>
            </div>
          )}

          {/* Tap-to-focus ring */}
          {tap && (
            <span
              key={tap.k}
              onAnimationEnd={() => setTap(null)}
              className="pointer-events-none absolute h-16 w-16 -translate-x-1/2 -translate-y-1/2 animate-ping rounded-full border-2 border-white/90"
              style={{ left: tap.x, top: tap.y, animationIterationCount: 1, animationDuration: '700ms' }}
            />
          )}

          {status === 'starting' && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-white" />
            </div>
          )}

          {status === 'error' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center">
              <CameraOff className="h-10 w-10 text-white/70" />
              <p className="text-sm text-white/90">{error}</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void start()}
                  className="rounded-xl bg-white px-4 py-2 text-xs font-bold text-black active:scale-95"
                >
                  Coba lagi
                </button>
                <button
                  type="button"
                  onClick={() => setPlainCamera(true)}
                  className="rounded-xl border border-white/40 px-4 py-2 text-xs font-bold text-white active:scale-95"
                >
                  Pakai kamera biasa
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Controls — bottom bar in portrait, right rail in landscape */}
        <div
          className={cn(
            'flex items-center justify-between px-8 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-4',
            'landscape:h-full landscape:w-36 landscape:flex-col landscape:justify-center landscape:gap-6',
            'landscape:px-3 landscape:py-6 landscape:pr-[calc(0.75rem+env(safe-area-inset-right))]',
          )}
        >
          {/* Document scanning: off by default — a plain photo until switched on */}
          <button
            type="button"
            onClick={() => setDocOn(v => !v)}
            aria-pressed={docOn}
            aria-label={docOn ? 'Matikan mode pindai dokumen' : 'Nyalakan mode pindai dokumen'}
            className={cn(
              'flex h-11 min-w-[68px] items-center justify-center gap-1 rounded-full px-3 text-xs font-bold active:scale-95',
              docOn ? 'bg-white text-black' : 'bg-white/10 text-white',
            )}
          >
            <ScanLine className="h-4 w-4" />
            Dokumen
          </button>

          <button
            type="button"
            onClick={() => shootRef.current()}
            disabled={!ready || shooting}
            aria-label="Pindai dokumen"
            className="relative flex h-[72px] w-[72px] items-center justify-center disabled:opacity-40"
          >
            <svg viewBox="0 0 72 72" className="absolute inset-0 -rotate-90" aria-hidden="true">
              <circle cx="36" cy="36" r="30" fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="4" />
              <circle
                cx="36" cy="36" r="30" fill="none" stroke="#22c55e" strokeWidth="5" strokeLinecap="round"
                strokeDasharray={ringLen}
                strokeDashoffset={ringLen * (1 - view.progress)}
                style={{ transition: 'stroke-dashoffset 120ms linear' }}
              />
            </svg>
            {shooting
              ? <Loader2 className="h-6 w-6 animate-spin text-white" />
              : <span className="h-[52px] w-[52px] rounded-full bg-white" />}
          </button>

          {/* Auto-capture belongs to scanning; without it the slot is a spacer that keeps the shutter centred */}
          {docOn ? (
            <button
              type="button"
              onClick={() => setAutoOn(v => !v)}
              aria-pressed={autoOn}
              className={cn(
                'flex h-11 min-w-[68px] items-center justify-center gap-1 rounded-full px-3 text-xs font-bold active:scale-95',
                autoOn ? 'bg-white text-black' : 'bg-white/10 text-white',
              )}
            >
              {autoOn ? <Zap className="h-4 w-4" /> : <ZapOff className="h-4 w-4" />}
              Auto
            </button>
          ) : (
            <div className="min-w-[68px]" aria-hidden="true" />
          )}
        </div>
      </div>

      {phase === 'review' && shot && (
        <ScanReview
          source={shot.canvas}
          initialQuad={shot.quad}
          title={title}
          plain={!shot.doc}
          onRetake={handleRetake}
          onClose={handleClose}
          onUse={onCapture}
        />
      )}
    </>
  );
}
