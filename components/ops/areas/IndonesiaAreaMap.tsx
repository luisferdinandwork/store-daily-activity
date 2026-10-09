'use client';
// components/ops/areas/IndonesiaAreaMap.tsx
//
// Sketch map for Area Management: each area is painted onto the regions its name
// points at (lib/area-map.ts), in the area's own colour. Hover a region (or a
// legend chip / table row, via `hoveredId`) to spotlight an area; click to open
// its detail. Areas the name matcher can't place are listed under the map instead
// of being dropped silently.
//
// Two views: all of Indonesia, and a zoomed "Pulau Jawa" — Java's provinces
// (Banten, DKI Jakarta, Jawa Barat …) are only a few pixels each at archipelago
// scale, so "DKI" and "Jabar" areas were impossible to tell apart. A region that
// two or more areas point at (say "DKI" and "Jabodetabek") is striped in both of
// their colours rather than showing only the first.

import { useId, useMemo, useState } from 'react';

import { cn } from '@/lib/utils';
import {
  JAVA_ZOOM_ANCHOR,
  MAP_REGIONS,
  MAP_VIEWS,
  polygonPath,
  projectLonLat,
  type MapViewId,
  type RegionId,
} from '@/lib/area-map';

export interface MapArea {
  id: number;
  name: string;
  color: string;
  regions: RegionId[];
}

/** Tooltip: "Banten — BANTEN, JABODETABEK 2 (dipakai bersama)". */
function regionTitle(label: string, owners: MapArea[]): string {
  if (owners.length === 0) return `${label} — belum ada area`;
  return `${label} — ${owners.map((a) => a.name).join(', ')}${owners.length > 1 ? ' (dipakai bersama)' : ''}`;
}

export default function IndonesiaAreaMap({
  areas,
  hoveredId,
  onHover,
  onSelect,
  className,
}: {
  areas: MapArea[];
  hoveredId: number | null;
  onHover: (id: number | null) => void;
  onSelect: (id: number) => void;
  className?: string;
}) {
  const uid = useId().replace(/:/g, '');
  const [viewId, setViewId] = useState<MapViewId>('indonesia');
  const view = MAP_VIEWS[viewId];
  const zoomed = viewId === 'jawa';

  const claims = useMemo(() => {
    const m = new Map<RegionId, MapArea[]>();
    for (const a of areas) {
      for (const r of a.regions) m.set(r, [...(m.get(r) ?? []), a]);
    }
    return m;
  }, [areas]);

  const unplaced = areas.filter((a) => a.regions.length === 0);
  const shared = MAP_REGIONS.filter((r) => (claims.get(r.id)?.length ?? 0) > 1);
  // The full map draws everything; a zoomed view only the regions it labels (Java + its neighbour Bali) —
  // a stray corner of Sumatra at the edge would just look like a mistake.
  const regions = zoomed ? MAP_REGIONS.filter((r) => r.labels[viewId]) : MAP_REGIONS;

  // Stripe width in SVG units: wide enough to read in the zoomed view, fine on the small regions of the full map.
  const stripe = zoomed ? 8 : 4;
  const labelSize = zoomed ? 12.5 : 10.5;

  const openJavaView = () => setViewId('jawa');

  return (
    <div className={className}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div role="tablist" aria-label="Tampilan peta" className="inline-flex rounded-lg bg-slate-100 p-0.5">
          {Object.values(MAP_VIEWS).map((v) => (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={viewId === v.id}
              onClick={() => setViewId(v.id)}
              className={cn(
                'rounded-md px-3 py-1 text-xs font-semibold transition',
                viewId === v.id ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700',
              )}
            >
              {v.label}
            </button>
          ))}
        </div>
        {zoomed && (
          <p className="text-[11px] text-slate-400">Banten, DKI Jakarta, Jawa Barat, Jawa Tengah, DIY, dan Jawa Timur digambar terpisah.</p>
        )}
      </div>

      <svg
        viewBox={`0 0 ${view.width} ${view.height}`}
        role="img"
        aria-label={zoomed ? 'Peta sketsa Pulau Jawa dengan pembagian area' : 'Peta sketsa Indonesia dengan pembagian area'}
        className="block h-auto w-full"
      >
        <defs>
          {/* One striped fill per region that more than one area points at. */}
          {shared.map((r) => {
            const owners = claims.get(r.id) ?? [];
            const w = stripe * owners.length;
            return (
              <pattern
                key={r.id}
                id={`${uid}-mix-${r.id}`}
                patternUnits="userSpaceOnUse"
                width={w}
                height={w}
                patternTransform="rotate(45)"
              >
                {owners.map((a, i) => (
                  <rect key={a.id} x={i * stripe} y={0} width={stripe} height={w} fill={a.color} />
                ))}
              </pattern>
            );
          })}
        </defs>

        {/* Shapes */}
        {regions.map((region) => {
          const owners = claims.get(region.id) ?? [];
          const owner = owners.find((a) => a.id === hoveredId) ?? owners[0];
          const dimmed = hoveredId != null && !owners.some((a) => a.id === hoveredId);
          const fill = owners.length > 1 ? `url(#${uid}-mix-${region.id})` : (owner?.color ?? '#e2e8f0');
          const active = owner != null && owners.some((a) => a.id === hoveredId);

          return (
            <g
              key={region.id}
              className={cn('transition-opacity', owner ? 'cursor-pointer' : '')}
              style={{ opacity: dimmed ? 0.35 : 1 }}
              onMouseEnter={() => owner && onHover(owner.id)}
              onMouseLeave={() => owner && onHover(null)}
              onClick={() => owner && onSelect(owner.id)}
            >
              {/* One string: React renders a <title> with several children empty on the server. */}
              <title>{regionTitle(region.label, owners)}</title>
              {region.polys.map((poly, i) => (
                <path
                  key={i}
                  d={polygonPath(poly, view)}
                  fill={fill}
                  stroke={active ? '#0f172a' : '#ffffff'}
                  strokeWidth={(active ? 1.6 : 1.2) * (zoomed ? 1.2 : 1)}
                  strokeLinejoin="round"
                />
              ))}
            </g>
          );
        })}

        {/* Labels — a second layer so a neighbour's shape never paints over a name. */}
        <g className="pointer-events-none select-none">
          {regions.map((region) => {
            const label = region.labels[viewId];
            if (!label) return null;
            const owned = (claims.get(region.id)?.length ?? 0) > 0;
            const [lx, ly] = projectLonLat(label.at, view);
            const to = label.pointTo ? projectLonLat(label.pointTo, view) : null;

            return (
              <g key={region.id}>
                {to && (
                  <>
                    <line x1={lx} y1={ly + 4} x2={to[0]} y2={to[1]} stroke="#475569" strokeWidth={1} />
                    <circle cx={to[0]} cy={to[1]} r={2.2} fill="#475569" />
                  </>
                )}
                <text
                  x={lx}
                  y={ly}
                  textAnchor="middle"
                  className="hidden sm:block"
                  style={{
                    fontSize: labelSize,
                    fontWeight: 700,
                    fill: owned || to ? '#0f172a' : '#94a3b8',
                    stroke: '#ffffff',
                    strokeWidth: 3,
                    paintOrder: 'stroke',
                  }}
                >
                  {region.short}
                </text>
              </g>
            );
          })}
        </g>

        {/* The way into the zoomed view, where Java's provinces would otherwise be unlabelled. */}
        {!zoomed &&
          (() => {
            const [x, y] = projectLonLat(JAVA_ZOOM_ANCHOR, view);
            return (
              <g
                role="button"
                tabIndex={0}
                aria-label="Perbesar peta Pulau Jawa"
                className="cursor-pointer"
                onClick={openJavaView}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    openJavaView();
                  }
                }}
              >
                <rect x={x - 54} y={y - 12} width={108} height={21} rx={10.5} fill="#ffffff" stroke="#c7d2fe" />
                <text x={x} y={y + 2.5} textAnchor="middle" style={{ fontSize: 10.5, fontWeight: 700, fill: '#4f46e5' }}>
                  Perbesar Jawa ›
                </text>
              </g>
            );
          })()}
      </svg>

      <ul className="mt-2 flex flex-wrap gap-1.5">
        {areas.map((a) => (
          <li key={a.id}>
            <button
              type="button"
              onMouseEnter={() => onHover(a.id)}
              onMouseLeave={() => onHover(null)}
              onFocus={() => onHover(a.id)}
              onBlur={() => onHover(null)}
              onClick={() => onSelect(a.id)}
              className={cn(
                'inline-flex max-w-full items-center gap-1.5 rounded-full border bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 transition',
                hoveredId === a.id ? 'border-slate-400 shadow-sm' : 'border-slate-200 hover:border-slate-300',
              )}
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: a.color }} />
              <span className="truncate">{a.name}</span>
            </button>
          </li>
        ))}
      </ul>

      {shared.length > 0 && (
        <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
          Wilayah bergaris dipakai lebih dari satu area:{' '}
          <span className="font-semibold text-slate-500">
            {shared
              .map((r) => `${r.short} (${(claims.get(r.id) ?? []).map((a) => a.name).join(', ')})`)
              .join(' · ')}
          </span>
        </p>
      )}

      {unplaced.length > 0 && (
        <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
          Belum bisa ditempatkan di peta (nama area tidak menyebut wilayah):{' '}
          <span className="font-semibold text-slate-500">{unplaced.map((a) => a.name).join(', ')}</span>
        </p>
      )}
    </div>
  );
}
