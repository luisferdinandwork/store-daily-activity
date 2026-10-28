'use client';
// components/shared/ZoomableImage.tsx
//
// An image inside a clipped stage that can be zoomed and moved — for checking a
// receipt photo in detail. Mouse wheel zooms towards the cursor, drag pans once
// zoomed, double-click toggles zoom, and the toolbar has +, −, rotate and reset.
// The stage fills whatever box the parent gives it (it needs a height).

import { useCallback, useEffect, useRef, useState } from 'react';
import { ImageOff, Maximize2, RotateCw, ZoomIn, ZoomOut } from 'lucide-react';
import { cn } from '@/lib/utils';

const MIN_SCALE = 1;
const MAX_SCALE = 8;
const BUTTON_STEP = 1.5;
const DOUBLE_CLICK_SCALE = 3;

interface View {
  scale: number;
  x: number;
  y: number;
  /** Quarter turns, clockwise. */
  turns: number;
}

const FIT: View = { scale: 1, x: 0, y: 0, turns: 0 };

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function ZoomableImage({
  src,
  alt,
  className,
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>(FIT);
  const [broken, setBroken] = useState(false);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);

  // Zoom around a point given relative to the stage's centre, keeping the image
  // point under it where it was.
  const zoomAt = useCallback((factor: number | ((s: number) => number), cx: number, cy: number) => {
    setView((v) => {
      const next = clamp(typeof factor === 'function' ? factor(v.scale) : v.scale * factor, MIN_SCALE, MAX_SCALE);
      if (next === v.scale) return v;
      if (next === MIN_SCALE) return { ...v, scale: MIN_SCALE, x: 0, y: 0 };
      const k = next / v.scale;
      return { ...v, scale: next, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
    });
  }, []);

  // React's onWheel is passive, so it can't stop the page from scrolling —
  // attach a native non-passive listener instead.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const cx = e.clientX - r.left - r.width / 2;
      const cy = e.clientY - r.top - r.height / 2;
      zoomAt(Math.exp(-e.deltaY * 0.0015), cx, cy);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (view.scale <= MIN_SCALE || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { px: e.clientX, py: e.clientY, x: view.x, y: view.y };
    setDragging(true);
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d) return;
    setView((v) => ({ ...v, x: d.x + e.clientX - d.px, y: d.y + e.clientY - d.py }));
  }

  function endDrag() {
    drag.current = null;
    setDragging(false);
  }

  function onDoubleClick(e: React.MouseEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const cx = e.clientX - r.left - r.width / 2;
    const cy = e.clientY - r.top - r.height / 2;
    zoomAt((s) => (s > MIN_SCALE ? MIN_SCALE : DOUBLE_CLICK_SCALE), cx, cy);
  }

  const zoomed = view.scale > MIN_SCALE;

  return (
    <div className={cn('relative flex min-h-0 flex-col bg-slate-900', className)}>
      <div
        ref={stageRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={onDoubleClick}
        className={cn(
          'relative flex min-h-0 flex-1 touch-none select-none items-center justify-center overflow-hidden',
          zoomed ? (dragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-zoom-in',
        )}
      >
        {broken ? (
          <div className="flex flex-col items-center gap-2 text-slate-400">
            <ImageOff className="h-10 w-10" />
            <p className="text-sm">Foto tidak bisa dimuat</p>
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={alt}
            draggable={false}
            onError={() => setBroken(true)}
            style={{
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale}) rotate(${view.turns * 90}deg)`,
              transition: dragging ? 'none' : 'transform 120ms ease-out',
            }}
            className="max-h-full max-w-full object-contain will-change-transform"
          />
        )}
      </div>

      {!broken && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
          <div className="pointer-events-auto flex items-center gap-0.5 rounded-full bg-black/60 p-1 text-white shadow-lg backdrop-blur">
            <ToolButton label="Perkecil" onClick={() => zoomAt(1 / BUTTON_STEP, 0, 0)} disabled={view.scale <= MIN_SCALE}>
              <ZoomOut className="h-4 w-4" />
            </ToolButton>
            <span className="w-12 text-center text-xs font-semibold tabular-nums">{Math.round(view.scale * 100)}%</span>
            <ToolButton label="Perbesar" onClick={() => zoomAt(BUTTON_STEP, 0, 0)} disabled={view.scale >= MAX_SCALE}>
              <ZoomIn className="h-4 w-4" />
            </ToolButton>
            <span className="mx-1 h-4 w-px bg-white/20" />
            <ToolButton label="Putar" onClick={() => setView((v) => ({ ...v, turns: (v.turns + 1) % 4 }))}>
              <RotateCw className="h-4 w-4" />
            </ToolButton>
            <ToolButton label="Sesuaikan layar" onClick={() => setView(FIT)} disabled={!zoomed && view.turns === 0}>
              <Maximize2 className="h-4 w-4" />
            </ToolButton>
          </div>
        </div>
      )}

      {!broken && !zoomed && (
        <p className="pointer-events-none absolute left-3 top-3 rounded-full bg-black/50 px-2.5 py-1 text-[11px] text-white/80">
          Scroll atau klik dua kali untuk zoom
        </p>
      )}
    </div>
  );
}

function ToolButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-white/15 disabled:opacity-30 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}
