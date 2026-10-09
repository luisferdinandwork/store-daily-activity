'use client';
// components/ops/areas/IndonesiaAreaMap.tsx
//
// Sketch map of Indonesia for Area Management: each area is painted onto the
// island regions its name points at (lib/area-map.ts), in the area's own colour.
// Hover a region (or a legend chip / table row, via `hoveredId`) to spotlight an
// area; click to open its detail. Areas the name matcher can't place are listed
// under the map instead of being dropped silently.

import { useId, useMemo } from 'react';

import { cn } from '@/lib/utils';
import {
  MAP_REGIONS,
  MAP_VIEWBOX,
  polygonPath,
  projectLonLat,
  type RegionId,
} from '@/lib/area-map';

export interface MapArea {
  id: number;
  name: string;
  color: string;
  regions: RegionId[];
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

  const claims = useMemo(() => {
    const m = new Map<RegionId, MapArea[]>();
    for (const a of areas) {
      for (const r of a.regions) m.set(r, [...(m.get(r) ?? []), a]);
    }
    return m;
  }, [areas]);

  const unplaced = areas.filter((a) => a.regions.length === 0);

  return (
    <div className={className}>
      <svg
        viewBox={`0 0 ${MAP_VIEWBOX.width} ${MAP_VIEWBOX.height}`}
        role="img"
        aria-label="Peta sketsa Indonesia dengan pembagian area"
        className="block h-auto w-full"
      >
        <defs>
          {MAP_REGIONS.filter((r) => r.clipLon).map((r) => {
            const [x0] = projectLonLat([r.clipLon![0], 0]);
            const [x1] = projectLonLat([r.clipLon![1], 0]);
            return (
              <clipPath key={r.id} id={`${uid}-${r.id}`}>
                <rect x={x0} y={0} width={x1 - x0} height={MAP_VIEWBOX.height} />
              </clipPath>
            );
          })}
        </defs>

        {MAP_REGIONS.map((region) => {
          const owners = claims.get(region.id) ?? [];
          const owner = owners.find((a) => a.id === hoveredId) ?? owners[0];
          const dimmed = hoveredId != null && !owners.some((a) => a.id === hoveredId);
          const [lx, ly] = projectLonLat(region.labelAt);

          return (
            <g
              key={region.id}
              className={cn('transition-opacity', owner ? 'cursor-pointer' : '')}
              style={{ opacity: dimmed ? 0.35 : 1 }}
              onMouseEnter={() => owner && onHover(owner.id)}
              onMouseLeave={() => owner && onHover(null)}
              onClick={() => owner && onSelect(owner.id)}
            >
              <title>
                {region.label}
                {owners.length ? ` — ${owners.map((a) => a.name).join(', ')}` : ' — belum ada area'}
              </title>
              <g clipPath={region.clipLon ? `url(#${uid}-${region.id})` : undefined}>
                {region.polys.map((poly, i) => (
                  <path
                    key={i}
                    d={polygonPath(poly)}
                    fill={owner ? owner.color : '#e2e8f0'}
                    stroke={owner && owner.id === hoveredId ? '#0f172a' : '#ffffff'}
                    strokeWidth={owner && owner.id === hoveredId ? 1.6 : 1.2}
                    strokeLinejoin="round"
                  />
                ))}
              </g>
              <text
                x={lx}
                y={ly}
                textAnchor="middle"
                className="hidden select-none sm:block"
                style={{
                  fontSize: 10.5,
                  fontWeight: 700,
                  fill: owner ? '#0f172a' : '#94a3b8',
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

      {unplaced.length > 0 && (
        <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
          Belum bisa ditempatkan di peta (nama area tidak menyebut wilayah):{' '}
          <span className="font-semibold text-slate-500">{unplaced.map((a) => a.name).join(', ')}</span>
        </p>
      )}
    </div>
  );
}
