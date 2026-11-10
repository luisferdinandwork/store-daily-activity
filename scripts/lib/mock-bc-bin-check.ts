// scripts/lib/mock-bc-bin-check.ts
//
// A stand-in for the two Business Central PP Bin Content Check feeds, with seeded
// sample results — so Cek Bin · "Hasil scan BC" can be looked at (and tested over real
// HTTP) without BC credentials. It answers for ANY store and day: the `location` and
// `date` of the request's `$filter` are echoed into the rows.
//
//   GET …/ppBinContentCheckHeaders?$expand=ppBinContentCheckLines&$filter=…   (lines expanded)
//   GET …/ppBinContentChecks?$filter=…                                         (per-bin summary)
//
// Used by scripts/mock-bc-bin-check.ts (npm run mock:bc-bin) and scripts/test-bin-check.ts.

import http from 'node:http';
import type { AddressInfo } from 'node:net';

// ── The seeded scenario ──────────────────────────────────────────────────────

type Status = 'OK' | 'Qty Lower Than Bin' | 'Qty Higher Than Bin' | 'Misplaced' | 'Not Scanned' | 'Not Found';

interface SampleLine {
  itemNo: string;
  variantCode: string;
  scan: number;
  inBin: number;
  status: Status;
  /** Where the item really belongs, when that is not the bin being checked. */
  actualBin?: string;
}

interface SampleBin {
  binCode: string;
  /** false = on BC's list but nobody scanned it (must never reach the employee). */
  checked: boolean;
  lines: SampleLine[];
}

const NOT_SCANNED_RUN: SampleLine[] = Array.from({ length: 9 }, (_, i) => ({
  itemNo: `ADI100010${i + 1}`,
  variantCode: String(40 + i),
  scan: 0,
  inBin: 1 + (i % 4),
  status: 'Not Scanned' as const,
}));

/** 4 bins checked (one fully correct), 1 unchecked. Wrong lines: 3 + 2 + 9 = 14 (+1 only the summary lists). */
export const SAMPLE_BINS: readonly SampleBin[] = [
  {
    binCode: 'GDM1A1', checked: true,
    lines: [
      { itemNo: 'SPE2010106', variantCode: 'L', scan: 1, inBin: 4, status: 'Qty Lower Than Bin' },
      { itemNo: 'SPE2010107', variantCode: 'M', scan: 0, inBin: 2, status: 'Not Scanned' },
      { itemNo: 'PUM08447502', variantCode: '050', scan: 2, inBin: 0, status: 'Misplaced', actualBin: 'GDM2B2' },
      { itemNo: 'NIK1000231', variantCode: '42', scan: 3, inBin: 3, status: 'OK' },
    ],
  },
  {
    binCode: 'GDM1A2', checked: true, // everything right
    lines: [
      { itemNo: 'ADI2000045', variantCode: '41', scan: 6, inBin: 6, status: 'OK' },
      { itemNo: 'ADI2000046', variantCode: '42', scan: 2, inBin: 2, status: 'OK' },
      { itemNo: 'PUM08447510', variantCode: 'XL', scan: 5, inBin: 5, status: 'OK' },
    ],
  },
  {
    binCode: 'GDM2B1', checked: true,
    lines: [
      { itemNo: 'ADI0000111', variantCode: '42', scan: 5, inBin: 3, status: 'Qty Higher Than Bin' },
      { itemNo: 'ASC1203A611.200', variantCode: '095', scan: 1, inBin: 0, status: 'Not Found' },
    ],
  },
  { binCode: 'GDM3C3', checked: true, lines: NOT_SCANNED_RUN }, // 9 rows → "Lihat semua"
  {
    binCode: 'GDM9Z9', checked: false,
    lines: [{ itemNo: 'SHOULDNOTSHOW', variantCode: 'S', scan: 0, inBin: 9, status: 'Not Scanned' }],
  },
];

/** A wrong item only the summary feed lists (no line, so no quantities) — exercises the merge. */
const SUMMARY_ONLY = { binCode: 'GDM1A1', field: 'skuNotFound', token: 'ASC9999999-095' } as const;

const odata = (s: string) => s.replace(/ /g, '_x0020_');
const dateKey = (day: string) => day.replace(/-/g, '');

export function sampleHeaders(location: string, day: string, expandLines: boolean) {
  return SAMPLE_BINS.map((b) => ({
    date: day, location, binCode: b.binCode, checked: b.checked, dateKey: dateKey(day),
    ...(expandLines
      ? {
          ppBinContentCheckLines: b.lines.map((l) => ({
            date: day, location, binCode: b.binCode, itemNo: l.itemNo, variantCode: l.variantCode,
            unitOfMeasureCode: 'PCS', actualBinCodes: l.actualBin ?? b.binCode,
            scanQuantity: l.scan, binQuantity: l.inBin, binContentCheckStatus: odata(l.status), dateKey: dateKey(day),
          })),
        }
      : {}),
  }));
}

const SUMMARY_FIELD: Partial<Record<Status, string>> = {
  'Qty Lower Than Bin': 'skuQtyLowerThanBin',
  'Qty Higher Than Bin': 'skuQtyHigherThanBin',
  Misplaced: 'skuMisplaced',
  'Not Scanned': 'skuNotScanned',
  'Not Found': 'skuNotFound',
};

export function sampleSummary(location: string, day: string) {
  return SAMPLE_BINS.map((b) => {
    const row: Record<string, unknown> = {
      date: day, location, binCode: b.binCode,
      skuQtyLowerThanBin: '', skuQtyHigherThanBin: '', skuMisplaced: '', skuNotScanned: '', skuNotFound: '',
    };
    const lists: Record<string, string[]> = {};
    for (const l of b.lines) {
      const field = SUMMARY_FIELD[l.status];
      if (field) (lists[field] ??= []).push(`${l.itemNo}-${l.variantCode}`);
    }
    if (b.binCode === SUMMARY_ONLY.binCode) (lists[SUMMARY_ONLY.field] ??= []).push(SUMMARY_ONLY.token);
    for (const [field, tokens] of Object.entries(lists)) row[field] = tokens.join('|');
    return row;
  });
}

// ── The server ───────────────────────────────────────────────────────────────

export interface MockBinCheckOptions {
  /** When set, Basic credentials must match; otherwise any Basic header is accepted. */
  username?: string;
  password?: string;
}

/** `location eq 'FF001' and date ge 2026-10-29 …` → what the request asks for. */
export function parseFilter(filter: string | null): { location: string; day: string } {
  const loc = /location eq '((?:[^']|'')*)'/.exec(filter ?? '');
  const day = /date ge (\d{4}-\d{2}-\d{2})/.exec(filter ?? '');
  return {
    location: loc ? loc[1].replace(/''/g, "'") : 'FF001',
    day: day ? day[1] : new Date().toISOString().slice(0, 10),
  };
}

export function createMockBinCheckServer(options: MockBinCheckOptions = {}): http.Server {
  return http.createServer((req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(body));
    };

    const auth = req.headers.authorization ?? '';
    const want = options.username != null
      ? `Basic ${Buffer.from(`${options.username}:${options.password ?? ''}`).toString('base64')}`
      : null;
    if (!auth.startsWith('Basic ') || (want && auth !== want)) {
      return send(401, { error: { code: 'Unauthorized', message: 'Mock BC: missing or wrong Basic credentials.' } });
    }

    const url = new URL(req.url ?? '/', 'http://mock.local');
    const { location, day } = parseFilter(url.searchParams.get('$filter'));
    const entity = url.pathname.split('/').filter(Boolean).pop();

    if (entity === 'ppBinContentCheckHeaders') {
      const expand = (url.searchParams.get('$expand') ?? '').includes('ppBinContentCheckLines');
      return send(200, { '@odata.context': 'mock', value: sampleHeaders(location, day, expand) });
    }
    if (entity === 'ppBinContentChecks') {
      return send(200, { '@odata.context': 'mock', value: sampleSummary(location, day) });
    }
    return send(404, { error: { code: 'NotFound', message: `Mock BC: unknown resource ${entity}` } });
  });
}

/** Starts on `port` (0 = any free port); resolves with the server and its base URL. */
export async function startMockBinCheckServer(
  port = 0,
  options: MockBinCheckOptions = {},
): Promise<{ server: http.Server; baseUrl: string }> {
  const server = createMockBinCheckServer(options);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const { port: bound } = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${bound}/` };
}
