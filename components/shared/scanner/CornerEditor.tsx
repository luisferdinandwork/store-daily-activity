'use client';
// components/shared/scanner/CornerEditor.tsx
// The captured frame with four draggable corner handles. The SVG's viewBox is
// the picture's own pixel grid, so handle positions are real source pixels and
// the letterboxing (`meet`) is handled by the browser.

import { useEffect, useRef, useState } from 'react';
import type { Point, Quad } from '@/lib/scanner/types';

interface CornerEditorProps {
  imageUrl: string;
  width: number;
  height: number;
  /** Corners in source pixels. */
  corners: Quad;
  onChange: (next: Quad) => void;
}

const HANDLE_PX = 9;
const HIT_PX = 28;

export default function CornerEditor({ imageUrl, width, height, corners, onChange }: CornerEditorProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  // Source pixels per screen pixel — keeps handles a constant, finger-sized size.
  const [unit, setUnit] = useState(1);
  const drag = useRef<{ index: number; dx: number; dy: number } | null>(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const measure = () => {
      const m = svg.getScreenCTM();
      if (m && m.a) setUnit(1 / m.a);
    };
    const ro = new ResizeObserver(measure);
    ro.observe(svg);
    return () => ro.disconnect();
  }, [width, height]);

  function toSource(e: React.PointerEvent): Point | null {
    const svg = svgRef.current;
    const m = svg?.getScreenCTM();
    if (!svg || !m) return null;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  }

  function onDown(e: React.PointerEvent<SVGCircleElement>, index: number) {
    const p = toSource(e);
    if (!p) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { index, dx: corners[index].x - p.x, dy: corners[index].y - p.y };
  }

  function onMove(e: React.PointerEvent<SVGCircleElement>) {
    const d = drag.current;
    const p = toSource(e);
    if (!d || !p) return;
    const next = corners.slice() as Quad;
    next[d.index] = {
      x: Math.min(width, Math.max(0, p.x + d.dx)),
      y: Math.min(height, Math.max(0, p.y + d.dy)),
    };
    onChange(next);
  }

  const outline = corners.map(p => `${p.x},${p.y}`).join(' ');
  const dim = `M0 0H${width}V${height}H0Z M${corners.map(p => `${p.x} ${p.y}`).join(' L')}Z`;

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      className="h-full w-full select-none"
      style={{ touchAction: 'none' }}
    >
      <image href={imageUrl} width={width} height={height} />
      <path d={dim} fillRule="evenodd" fill="rgba(0,0,0,0.55)" />
      <polygon
        points={outline}
        fill="none"
        stroke="#22c55e"
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
      />
      {corners.map((c, i) => (
        <g key={i}>
          <circle cx={c.x} cy={c.y} r={HANDLE_PX * unit} fill="#22c55e" stroke="#fff" strokeWidth={2} vectorEffect="non-scaling-stroke" />
          <circle
            cx={c.x}
            cy={c.y}
            r={HIT_PX * unit}
            fill="transparent"
            style={{ touchAction: 'none', cursor: 'grab' }}
            onPointerDown={e => onDown(e, i)}
            onPointerMove={onMove}
            onPointerUp={() => { drag.current = null; }}
            onPointerCancel={() => { drag.current = null; }}
          />
        </g>
      ))}
    </svg>
  );
}
