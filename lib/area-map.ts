// lib/area-map.ts
//
// Data behind the Area Management sketch map of Indonesia: simplified island
// outlines (lon/lat, hand-drawn — a sketch, not a survey), the regions they
// group into, and the name → region matching that decides where an area is
// drawn. Areas are free-text (HR "Zona" names such as "DKI - BALI"), so one
// area can cover several regions; an area nothing matches is simply listed as
// "not on the map". Rendering: components/ops/areas/IndonesiaAreaMap.tsx.
//
// Two views share this data: the whole archipelago, and a zoomed "Pulau Jawa"
// view. Java's provinces (Banten, DKI Jakarta, Jawa Barat, Jawa Tengah, DIY,
// Jawa Timur) are far too small to tell apart at archipelago scale — Jakarta is
// a few pixels there — and "DKI" / "Jabar" areas used to share one region, so one
// of them was never drawn.

export type RegionId =
  | 'sumatera'
  | 'banten'
  | 'dki-jakarta'
  | 'jawa-barat'
  | 'jawa-tengah'
  | 'diy'
  | 'jawa-timur'
  | 'bali'
  | 'nusa-tenggara'
  | 'kalimantan'
  | 'sulawesi'
  | 'maluku'
  | 'papua';

export type LonLat = [lon: number, lat: number];

export type MapViewId = 'indonesia' | 'jawa';

/** Text on the map. A region too small to hold its name gets the text beside it and a line pointing in. */
export interface MapLabel {
  at: LonLat;
  pointTo?: LonLat;
}

export interface MapRegion {
  id: RegionId;
  /** Full name — the tooltip. */
  label: string;
  /** What the map itself prints. */
  short: string;
  /** Polygons in lon/lat. */
  polys: LonLat[][];
  /** One of Java's provinces: labelled in the Pulau Jawa view, summed up as "Jawa" in the Indonesia view. */
  java?: boolean;
  /** Where the label sits, per view (no entry = not labelled in that view). */
  labels: Partial<Record<MapViewId, MapLabel>>;
}

const SUMATERA: LonLat[] = [
  [95.3, 5.6], [97.6, 5.2], [98.3, 4.0], [99.9, 3.0], [100.9, 2.4], [101.6, 2.0], [102.6, 1.5], [103.6, 0.9],
  [103.9, -0.3], [104.4, -1.1], [104.9, -2.0], [105.8, -2.9], [106.0, -3.7], [105.9, -4.8], [105.8, -5.8],
  [105.0, -5.9], [104.6, -5.6], [103.9, -5.1], [102.9, -4.6], [102.3, -3.9], [101.4, -2.8], [100.8, -1.9],
  [100.3, -0.9], [99.6, -0.1], [99.0, 0.7], [98.7, 1.7], [97.8, 2.7], [96.7, 3.6], [95.6, 4.8],
];

// ─── Java ────────────────────────────────────────────────────────────────────
// One coastline cut into its provinces. Every boundary is a single list of points
// used by both neighbours (one of them reversed), so provinces meet exactly — no
// gaps, no overlap. Orientation does not matter for an SVG fill.

const J = {
  // Where boundaries meet the sea (and the one triple point inland of it).
  S_B: [106.4, -6.97] as LonLat, // Banten | Jawa Barat, south coast
  N_B: [106.68, -6.05] as LonLat, // Banten | DKI, north coast
  E_D: [106.98, -6.07] as LonLat, // DKI | Jawa Barat, north coast
  N_J: [108.78, -6.82] as LonLat, // Jawa Barat | Jawa Tengah, north coast
  J_S: [108.62, -7.72] as LonLat, // Jawa Barat | Jawa Tengah, south coast
  N_T: [111.52, -6.78] as LonLat, // Jawa Tengah | Jawa Timur, north coast
  T_D: [111.05, -7.95] as LonLat, // Jawa Tengah | Jawa Timur | DIY
  D_E: [111.0, -8.17] as LonLat, // DIY | Jawa Timur, south coast
  D_W: [110.02, -7.95] as LonLat, // DIY | Jawa Tengah, south coast
};

// Coastlines between those points.
const COAST_BANTEN: LonLat[] = [
  J.S_B, [106.1, -6.93], [105.8, -6.86], [105.5, -6.8], [105.22, -6.76], [105.3, -6.58], [105.55, -6.46],
  [105.8, -6.36], [105.95, -6.08], [106.01, -5.92], [106.25, -5.9], [106.45, -5.98], J.N_B,
];
const COAST_DKI: LonLat[] = [J.N_B, [106.78, -6.09], [106.88, -6.08], J.E_D];
const COAST_JABAR_N: LonLat[] = [
  J.E_D, [107.05, -5.98], [107.2, -5.93], [107.4, -6.0], [107.65, -6.2], [107.85, -6.25], [108.05, -6.3],
  [108.3, -6.3], [108.45, -6.45], [108.55, -6.72], J.N_J,
];
const COAST_JABAR_S: LonLat[] = [
  J.J_S, [108.3, -7.7], [108.0, -7.68], [107.7, -7.66], [107.35, -7.48], [107.0, -7.42], [106.6, -7.38],
  [106.4, -7.3], [106.5, -7.1], J.S_B,
];
const COAST_JATENG_N: LonLat[] = [
  J.N_J, [109.05, -6.85], [109.35, -6.88], [109.65, -6.88], [109.95, -6.88], [110.3, -6.92], [110.5, -6.92],
  [110.55, -6.72], [110.7, -6.55], [110.9, -6.55], [111.1, -6.65], [111.3, -6.72], J.N_T,
];
const COAST_JATENG_S: LonLat[] = [J.D_W, [109.75, -7.82], [109.45, -7.72], [109.1, -7.68], [108.85, -7.65], J.J_S];
const COAST_DIY: LonLat[] = [J.D_E, [110.75, -8.21], [110.52, -8.17], [110.3, -8.03], J.D_W];
const COAST_JATIM: LonLat[] = [
  J.N_T, [111.85, -6.85], [112.1, -6.9], [112.4, -6.88], [112.6, -7.1], [112.75, -7.22], [112.85, -7.45],
  [112.95, -7.65], [113.3, -7.72], [113.65, -7.72], [114.0, -7.72], [114.3, -7.95], [114.42, -8.15],
  [114.52, -8.45], [114.45, -8.72], [114.1, -8.62], [113.85, -8.52], [113.5, -8.4], [113.15, -8.3],
  [112.75, -8.4], [112.35, -8.35], [111.95, -8.3], [111.55, -8.28], [111.2, -8.25], J.D_E,
];

// Boundaries.
/** Banten | the rest, from the south coast up to DKI — its last stretch is DKI's west edge too. */
const B_BANTEN: LonLat[] = [J.S_B, [106.47, -6.78], [106.55, -6.58], [106.62, -6.42], [106.7, -6.32], [106.7, -6.2], J.N_B];
const DKI_SOUTH: LonLat[] = [[106.7, -6.32], [106.85, -6.38], [106.97, -6.36]];
const DKI_EAST: LonLat[] = [[106.97, -6.36], [106.99, -6.2], J.E_D];
const B_JABAR_JATENG: LonLat[] = [J.N_J, [108.72, -7.05], [108.64, -7.4], J.J_S];
const B_JATENG_JATIM: LonLat[] = [J.N_T, [111.4, -7.15], [111.2, -7.55], J.T_D];
/** DIY | Jawa Tengah, from DIY's south-east corner round the north to its south-west coast. */
const B_DIY: LonLat[] = [J.T_D, [110.85, -7.8], [110.65, -7.62], [110.42, -7.55], [110.2, -7.62], [110.05, -7.75], J.D_W];

const rev = (pts: LonLat[]): LonLat[] => [...pts].reverse();
/** Joins polylines end to start into one ring, dropping each repeated joint. */
const ring = (...parts: LonLat[][]): LonLat[] => parts.flatMap((part, i) => (i === 0 ? part : part.slice(1)));

const BANTEN: LonLat[] = ring(COAST_BANTEN, rev(B_BANTEN));
const DKI: LonLat[] = ring(COAST_DKI, rev(DKI_EAST), rev(DKI_SOUTH), B_BANTEN.slice(-3));
const JABAR: LonLat[] = ring(COAST_JABAR_N, B_JABAR_JATENG, COAST_JABAR_S, B_BANTEN.slice(0, 5), DKI_SOUTH, DKI_EAST);
const JATENG: LonLat[] = ring(COAST_JATENG_N, B_JATENG_JATIM, B_DIY, COAST_JATENG_S, rev(B_JABAR_JATENG));
const DIY: LonLat[] = ring(COAST_DIY, rev(B_DIY));
const JATIM: LonLat[] = ring(COAST_JATIM, [J.D_E, ...rev(B_JATENG_JATIM)]);

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
  { id: 'sumatera', label: 'Sumatera', short: 'Sumatera', polys: [SUMATERA], labels: { indonesia: { at: [100.6, 0.5] } } },
  {
    id: 'banten', label: 'Banten', short: 'Banten', polys: [BANTEN], java: true,
    labels: { jawa: { at: [105.95, -6.62] } },
  },
  {
    id: 'dki-jakarta', label: 'DKI Jakarta', short: 'DKI Jakarta', polys: [DKI], java: true,
    labels: { jawa: { at: [106.84, -5.68], pointTo: [106.84, -6.18] } },
  },
  {
    id: 'jawa-barat', label: 'Jawa Barat', short: 'Jawa Barat', polys: [JABAR], java: true,
    labels: { jawa: { at: [107.75, -7.1] } },
  },
  {
    id: 'jawa-tengah', label: 'Jawa Tengah', short: 'Jawa Tengah', polys: [JATENG], java: true,
    labels: { jawa: { at: [109.85, -7.35] } },
  },
  {
    id: 'diy', label: 'DI Yogyakarta', short: 'DIY', polys: [DIY], java: true,
    labels: { jawa: { at: [110.55, -8.6], pointTo: [110.5, -8.05] } },
  },
  {
    id: 'jawa-timur', label: 'Jawa Timur', short: 'Jawa Timur', polys: [JATIM, MADURA], java: true,
    labels: { jawa: { at: [112.75, -7.9] } },
  },
  { id: 'bali', label: 'Bali', short: 'Bali', polys: [BALI], labels: { indonesia: { at: [115.1, -9.5] }, jawa: { at: [115.1, -8.5] } } },
  {
    id: 'nusa-tenggara', label: 'Nusa Tenggara', short: 'Nusa Tenggara', polys: NUSA_TENGGARA,
    labels: { indonesia: { at: [121.7, -10.7] } },
  },
  { id: 'kalimantan', label: 'Kalimantan', short: 'Kalimantan', polys: [KALIMANTAN], labels: { indonesia: { at: [113.6, -0.4] } } },
  { id: 'sulawesi', label: 'Sulawesi', short: 'Sulawesi', polys: [SULAWESI], labels: { indonesia: { at: [121.2, -2.3] } } },
  { id: 'maluku', label: 'Maluku', short: 'Maluku', polys: MALUKU, labels: { indonesia: { at: [128.7, -2.2] } } },
  { id: 'papua', label: 'Papua', short: 'Papua', polys: [PAPUA], labels: { indonesia: { at: [137.5, -4.8] } } },
];

/** Java's provinces, west → east. */
export const JAVA_REGIONS: RegionId[] = MAP_REGIONS.filter((r) => r.java).map((r) => r.id);

/** Where the Indonesia view prints its single "Jawa · perbesar" button (Java's provinces are unlabelled there). */
export const JAVA_ZOOM_ANCHOR: LonLat = [109.9, -9.75];

// ─── Views + projection (equirectangular) ────────────────────────────────────

export interface MapView {
  id: MapViewId;
  label: string;
  /** Longitude / latitude of the top-left corner. */
  lonMin: number;
  latMax: number;
  /** SVG units per degree. */
  scale: number;
  width: number;
  height: number;
}

export const MAP_VIEWS: Record<MapViewId, MapView> = {
  indonesia: { id: 'indonesia', label: 'Indonesia', lonMin: 94.5, latMax: 6.5, scale: 20, width: 940, height: 350 },
  // 105.0°E–115.9°E, 5.55°S–9.05°S at 85 units/degree: Jakarta (~0.3° across) is ~25 units wide.
  jawa: { id: 'jawa', label: 'Pulau Jawa', lonMin: 105.0, latMax: -5.55, scale: 85, width: 927, height: 290 },
};

export function projectLonLat([lon, lat]: LonLat, view: MapView = MAP_VIEWS.indonesia): [number, number] {
  return [(lon - view.lonMin) * view.scale, (view.latMax - lat) * view.scale];
}

export function polygonPath(points: LonLat[], view: MapView = MAP_VIEWS.indonesia): string {
  return (
    points
      .map((p, i) => {
        const [x, y] = projectLonLat(p, view);
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
  // "Jabodetabek" = Jakarta + Bogor / Depok / Tangerang / Bekasi, so it paints all three.
  banten: ['banten', 'tangerang', 'tangsel', 'serang', 'cilegon', 'lebak', 'pandeglang', 'jabodetabek'],
  'dki-jakarta': ['dki', 'jakarta', 'jkt', 'jabodetabek'],
  'jawa-barat': [
    'jabar', 'jawa barat', 'bekasi', 'bogor', 'depok', 'bandung', 'cirebon', 'karawang', 'sukabumi', 'cianjur',
    'garut', 'tasikmalaya', 'subang', 'indramayu', 'jabodetabek',
  ],
  'jawa-tengah': [
    'jateng', 'jawa tengah', 'semarang', 'solo', 'surakarta', 'pekalongan', 'tegal', 'kudus', 'cilacap', 'magelang',
  ],
  diy: ['diy', 'yogyakarta', 'yogya', 'jogja', 'jogjakarta'],
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
