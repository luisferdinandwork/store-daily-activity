// lib/area-map.ts
//
// Data behind the Area Management sketch map of Indonesia: simplified island
// outlines (lon/lat, hand-drawn — a sketch, not a survey), the regions they
// group into, and the name → region matching that decides where an area is
// drawn. Areas are free-text (HR "Zona" names such as "DKI - BALI"), so one
// area can cover several regions; an area nothing matches is simply listed as
// "not on the map". Rendering: components/ops/areas/IndonesiaAreaMap.tsx.

export type RegionId =
  | 'sumatera'
  | 'jawa-barat'
  | 'jawa-tengah'
  | 'jawa-timur'
  | 'bali'
  | 'nusa-tenggara'
  | 'kalimantan'
  | 'sulawesi'
  | 'maluku'
  | 'papua';

type LonLat = [lon: number, lat: number];

export interface MapRegion {
  id: RegionId;
  label: string;
  /** What the map itself prints (the long label goes in the tooltip). */
  short: string;
  /** Polygons in lon/lat. */
  polys: LonLat[][];
  /** Draw only this longitude slice of the polygons (Java is split west / central / east). */
  clipLon?: [number, number];
  /** Where the label sits. */
  labelAt: LonLat;
}

const SUMATERA: LonLat[] = [
  [95.3, 5.6], [97.6, 5.2], [98.3, 4.0], [99.9, 3.0], [100.9, 2.4], [101.6, 2.0], [102.6, 1.5], [103.6, 0.9],
  [103.9, -0.3], [104.4, -1.1], [104.9, -2.0], [105.8, -2.9], [106.0, -3.7], [105.9, -4.8], [105.8, -5.8],
  [105.0, -5.9], [104.6, -5.6], [103.9, -5.1], [102.9, -4.6], [102.3, -3.9], [101.4, -2.8], [100.8, -1.9],
  [100.3, -0.9], [99.6, -0.1], [99.0, 0.7], [98.7, 1.7], [97.8, 2.7], [96.7, 3.6], [95.6, 4.8],
];

const JAVA: LonLat[] = [
  [105.2, -6.8], [105.9, -5.95], [106.8, -6.0], [107.9, -6.2], [108.6, -6.7], [109.3, -6.9], [110.4, -6.9],
  [111.1, -6.5], [112.2, -6.9], [112.9, -7.2], [113.9, -7.7], [114.5, -7.9], [114.4, -8.7], [113.5, -8.4],
  [112.0, -8.3], [110.8, -8.1], [109.4, -7.8], [108.3, -7.8], [107.2, -7.7], [106.5, -7.4], [105.6, -7.0],
];

const MADURA: LonLat[] = [[112.7, -6.95], [113.5, -6.9], [114.1, -7.1], [113.4, -7.25], [112.8, -7.2]];

const BALI: LonLat[] = [[114.5, -8.2], [115.2, -8.05], [115.7, -8.4], [115.5, -8.8], [115.0, -8.85], [114.6, -8.6]];

const NUSA_TENGGARA: LonLat[][] = [
  [[115.9, -8.4], [116.7, -8.3], [116.75, -8.9], [116.0, -8.95]], // Lombok
  [[116.8, -8.5], [118.0, -8.3], [119.0, -8.6], [118.2, -8.9], [117.0, -9.0]], // Sumbawa
  [[119.8, -8.5], [121.0, -8.4], [122.5, -8.4], [122.9, -8.8], [121.5, -8.95], [120.0, -8.8]], // Flores
  [[119.2, -9.5], [120.4, -9.4], [120.9, -9.9], [119.9, -10.3], [119.0, -9.9]], // Sumba
  [[123.5, -10.3], [124.0, -9.6], [125.0, -9.2], [126.2, -8.5], [127.2, -8.4], [127.0, -8.9], [125.5, -9.5], [124.5, -10.2]], // Timor
];

const KALIMANTAN: LonLat[] = [
  [109.0, 1.8], [110.1, 1.7], [111.1, 1.0], [112.3, 1.4], [113.8, 1.5], [114.9, 2.2], [115.8, 3.5], [117.0, 4.2],
  [118.0, 4.2], [117.6, 3.3], [117.9, 2.0], [118.0, 1.0], [117.5, 0.1], [117.6, -0.8], [116.8, -1.3], [116.3, -2.3],
  [116.3, -3.2], [116.0, -3.9], [114.7, -4.0], [114.0, -3.5], [112.5, -3.4], [111.5, -3.2], [110.3, -3.0],
  [110.0, -2.0], [109.9, -1.0], [109.1, -0.1], [108.9, 0.9],
];

const SULAWESI: LonLat[] = [
  [120.0, 0.9], [121.3, 1.0], [122.8, 1.0], [124.4, 1.2], [125.2, 1.6], [124.6, 0.8], [123.2, 0.5], [121.8, 0.4],
  [121.2, -0.4], [122.4, -0.8], [123.4, -0.9], [123.3, -1.5], [122.0, -1.6], [121.5, -1.9], [121.6, -2.8],
  [122.2, -3.4], [122.7, -4.0], [123.2, -4.8], [122.9, -5.4], [122.2, -5.0], [121.9, -4.2], [121.4, -3.9],
  [120.8, -3.0], [120.5, -3.1], [120.4, -4.2], [120.5, -5.2], [120.4, -5.7], [119.6, -5.5], [119.4, -5.0],
  [119.5, -4.0], [118.9, -3.5], [118.8, -2.7], [119.4, -1.7], [119.7, -0.7], [119.9, -0.2],
];

const MALUKU: LonLat[][] = [
  [[127.6, 1.9], [128.2, 1.5], [128.3, 0.5], [128.0, -0.8], [127.6, -0.5], [127.9, 0.2], [127.4, 0.6], [127.4, 1.3]], // Halmahera
  [[128.0, -3.0], [130.5, -2.8], [130.8, -3.3], [129.0, -3.4], [128.2, -3.5]], // Seram
  [[126.0, -3.3], [127.2, -3.3], [127.2, -3.9], [126.0, -3.7]], // Buru
  [[131.0, -7.3], [131.5, -7.0], [131.8, -8.0], [131.2, -8.1]], // Tanimbar
];

const PAPUA: LonLat[] = [
  [130.9, -0.4], [132.4, -0.3], [134.0, -0.8], [134.3, -1.8], [135.2, -3.3], [136.4, -2.3], [138.0, -1.7],
  [139.8, -2.4], [141.0, -2.6], [141.0, -9.1], [140.0, -8.4], [138.5, -8.2], [137.8, -7.0], [138.2, -5.8],
  [136.5, -4.6], [135.0, -4.2], [133.7, -3.9], [132.9, -3.2], [132.3, -2.5], [131.6, -1.5], [130.9, -0.9],
];

export const MAP_REGIONS: MapRegion[] = [
  { id: 'sumatera', label: 'Sumatera', short: 'Sumatera', polys: [SUMATERA], labelAt: [100.6, 0.5] },
  { id: 'jawa-barat', label: 'Banten · DKI · Jabar', short: 'Jabar', polys: [JAVA], clipLon: [104.5, 108.6], labelAt: [107.2, -9.3] },
  { id: 'jawa-tengah', label: 'Jawa Tengah · DIY', short: 'Jateng', polys: [JAVA], clipLon: [108.6, 111.0], labelAt: [109.8, -9.3] },
  { id: 'jawa-timur', label: 'Jawa Timur', short: 'Jatim', polys: [JAVA, MADURA], clipLon: [111.0, 115.0], labelAt: [112.6, -9.3] },
  { id: 'bali', label: 'Bali', short: 'Bali', polys: [BALI], labelAt: [115.1, -9.5] },
  { id: 'nusa-tenggara', label: 'Nusa Tenggara', short: 'Nusa Tenggara', polys: NUSA_TENGGARA, labelAt: [121.7, -10.7] },
  { id: 'kalimantan', label: 'Kalimantan', short: 'Kalimantan', polys: [KALIMANTAN], labelAt: [113.6, -0.4] },
  { id: 'sulawesi', label: 'Sulawesi', short: 'Sulawesi', polys: [SULAWESI], labelAt: [121.2, -2.3] },
  { id: 'maluku', label: 'Maluku', short: 'Maluku', polys: MALUKU, labelAt: [128.7, -2.2] },
  { id: 'papua', label: 'Papua', short: 'Papua', polys: [PAPUA], labelAt: [137.5, -4.8] },
];

// ─── Projection (equirectangular, 20 units per degree) ───────────────────────

const LON_MIN = 94.5;
const LAT_MAX = 6.5;
const SCALE = 20;

export const MAP_VIEWBOX = { width: 940, height: 350 };

export function projectLonLat([lon, lat]: LonLat): [number, number] {
  return [(lon - LON_MIN) * SCALE, (LAT_MAX - lat) * SCALE];
}

export function polygonPath(points: LonLat[]): string {
  return (
    points
      .map((p, i) => {
        const [x, y] = projectLonLat(p);
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join('') + 'Z'
  );
}

// ─── Area name → regions ─────────────────────────────────────────────────────

/** Whole-word keywords (tokens of the lower-cased area name) per region. */
const REGION_KEYWORDS: Record<RegionId, string[]> = {
  sumatera: [
    'sumatera', 'sumatra', 'sumut', 'sumbar', 'sumsel', 'aceh', 'medan', 'padang', 'palembang', 'lampung',
    'riau', 'kepri', 'batam', 'jambi', 'bengkulu', 'bangka', 'belitung', 'pekanbaru',
  ],
  'jawa-barat': [
    'dki', 'jakarta', 'jabodetabek', 'jabar', 'jawa barat', 'banten', 'bekasi', 'bogor', 'depok', 'tangerang',
    'bandung', 'cirebon', 'karawang',
  ],
  'jawa-tengah': ['jateng', 'jawa tengah', 'semarang', 'yogyakarta', 'yogya', 'jogja', 'diy', 'solo', 'surakarta'],
  'jawa-timur': ['jatim', 'jawa timur', 'surabaya', 'malang', 'madura'],
  bali: ['bali', 'denpasar'],
  'nusa-tenggara': ['ntb', 'ntt', 'nusa tenggara', 'nusra', 'lombok', 'mataram', 'kupang', 'flores', 'sumbawa'],
  kalimantan: [
    'kalimantan', 'borneo', 'kalbar', 'kalsel', 'kaltim', 'kalteng', 'kaltara', 'pontianak', 'banjarmasin',
    'balikpapan', 'samarinda',
  ],
  sulawesi: ['sulawesi', 'sulsel', 'sulut', 'sulteng', 'sultra', 'sulbar', 'gorontalo', 'makassar', 'manado'],
  maluku: ['maluku', 'malut', 'ambon', 'ternate', 'halmahera'],
  papua: ['papua', 'jayapura', 'sorong', 'merauke', 'manokwari'],
};

/** "Jawa" / "Java" on its own means the whole island. */
const WHOLE_JAVA_KEYWORDS = ['jawa', 'java'];
const JAVA_REGIONS: RegionId[] = ['jawa-barat', 'jawa-tengah', 'jawa-timur'];

/** The map regions an area name points at (empty when nothing matches). */
export function regionsForAreaName(name: string): RegionId[] {
  const padded = ` ${name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
  const has = (kw: string) => padded.includes(` ${kw} `);

  const found = new Set<RegionId>();
  for (const region of Object.keys(REGION_KEYWORDS) as RegionId[]) {
    if (REGION_KEYWORDS[region].some(has)) found.add(region);
  }
  if (WHOLE_JAVA_KEYWORDS.some(has) && !JAVA_REGIONS.some((r) => found.has(r))) {
    JAVA_REGIONS.forEach((r) => found.add(r));
  }
  return [...found];
}

// ─── Colours ─────────────────────────────────────────────────────────────────

/** One fixed colour per area (by position in the name-sorted list), so a map, its legend and its table agree. */
export const AREA_COLORS = [
  '#6366f1', '#10b981', '#f59e0b', '#f43f5e', '#06b6d4', '#8b5cf6',
  '#84cc16', '#f97316', '#14b8a6', '#d946ef', '#0ea5e9', '#ec4899',
] as const;

export function areaColor(index: number): string {
  return AREA_COLORS[((index % AREA_COLORS.length) + AREA_COLORS.length) % AREA_COLORS.length];
}
