// scripts/test-bin-check.ts
// Checks for the Cek Bin · BC results feature — no DB, no network, no real credentials:
// the BC calls are answered by a stubbed `fetch` carrying the sample payloads of the
// two PP Bin Content Check APIs.
//   npm run test:bin-check
//
// Covers the pure rules (lib/bin-check.ts: status decoding, wrong-only, merging the
// headers + summary feeds, store/day scoping) and the server module
// (lib/bc/bin-content-check.ts: URL/$filter/auth, cache, fail-soft states, pagination,
// timeout, env override).

import assert from 'node:assert/strict';

import {
  buildBinCheckIssues,
  decodeODataText,
  groupIssuesByReason,
  issueSku,
  judgeStatus,
  splitSkuList,
  splitSkuToken,
} from '../lib/bin-check';
import {
  BC_BIN_CHECK_DEFAULT_BASE_URL,
  binCheckHeadersUrl,
  binCheckSummaryUrl,
  clearBinCheckCache,
  getBinCheckResult,
  normalizeBinCheckBaseUrl,
  resolveBinCheckConfig,
} from '../lib/bc/bin-content-check';
import { fetchAllBusinessCentralRows } from '../lib/bc/client';
import { startMockBinCheckServer } from './lib/mock-bc-bin-check';

let checks = 0;
const ok = async (name: string, fn: () => void | Promise<void>) => {
  await fn();
  checks += 1;
  console.log(`  ✓ ${name}`);
};

// ── Sample payloads (the shapes BC returns) ──────────────────────────────────

const line = (over: Record<string, unknown>) => ({
  date: '2026-10-29', location: 'FF001', binCode: 'GDM1A1', itemNo: 'SPE2010106', variantCode: 'L',
  unitOfMeasureCode: 'PCS', actualBinCodes: 'GDM1A1', scanQuantity: 1, binQuantity: 4,
  binContentCheckStatus: 'Qty_x0020_Lower_x0020_Than_x0020_Bin', dateKey: '20261029', ...over,
});

const HEADERS = {
  value: [
    {
      date: '2026-10-29', location: 'FF001', binCode: 'GDM1A1', checked: true, dateKey: '20261029',
      ppBinContentCheckLines: [
        line({}),
        line({ itemNo: 'SPE2010107', variantCode: 'M', scanQuantity: 0, binQuantity: 2, binContentCheckStatus: 'Not_x0020_Scanned' }),
        line({ itemNo: 'OKITEM', variantCode: 'S', scanQuantity: 3, binQuantity: 3, binContentCheckStatus: 'OK' }),
        line({ itemNo: 'PUM08447502', variantCode: '050', binCode: 'GDM1A1', actualBinCodes: 'GDM2B2', scanQuantity: 2, binQuantity: 0, binContentCheckStatus: 'Misplaced' }),
      ],
    },
    // A bin BC lists but nobody scanned — not a result.
    {
      date: '2026-10-29', location: 'FF001', binCode: 'GDM9Z9', checked: false, dateKey: '20261029',
      ppBinContentCheckLines: [line({ binCode: 'GDM9Z9', itemNo: 'IGNORED', binContentCheckStatus: 'Not_x0020_Scanned' })],
    },
    // Another store's bin must never leak in, even if the filter were ignored.
    {
      date: '2026-10-29', location: 'FF002', binCode: 'GDM1A1', checked: true,
      ppBinContentCheckLines: [line({ location: 'FF002', itemNo: 'OTHERSTORE', binContentCheckStatus: 'Not_x0020_Scanned' })],
    },
  ],
};

const SUMMARY = {
  value: [
    {
      date: '2026-10-29', location: 'FF001', binCode: 'GDM1A1',
      skuQtyLowerThanBin: 'SPE2010106-L', skuQtyHigherThanBin: '', skuMisplaced: 'PUM08447502-050',
      skuNotScanned: 'SPE2010107-M|B-S', skuNotFound: 'ASC1203A611.200-095',
    },
    // Summary of the unscanned bin — dropped because the headers say it was not checked.
    { date: '2026-10-29', location: 'FF001', binCode: 'GDM9Z9', skuNotScanned: 'IGNORED-X' },
  ],
};

// ── Stubbed fetch ────────────────────────────────────────────────────────────

type Call = { url: string; auth: string | null };
let calls: Call[] = [];
let handler: (url: string) => Response | Promise<Response> = () => new Response('{}', { status: 404 });
const realFetch = globalThis.fetch;

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const auth = new Headers(init?.headers).get('authorization');
  calls.push({ url, auth });
  if (init?.signal?.aborted) throw init.signal.reason;
  return handler(url);
}) as typeof fetch;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const happy = (url: string) =>
  url.includes('/ppBinContentCheckHeaders?') ? json(HEADERS) :
  url.includes('/ppBinContentChecks?') ? json(SUMMARY) : new Response('', { status: 404 });

function setEnv(env: Record<string, string | undefined>) {
  for (const k of ['BC_API_BIN_USERNAME', 'BC_API_BIN_PASSWORD', 'BC_API_BIN_BASE_URL']) delete process.env[k];
  for (const [k, v] of Object.entries(env)) if (v !== undefined) process.env[k] = v;
}
function reset(env: Record<string, string | undefined>, h: typeof handler = happy) {
  setEnv(env);
  clearBinCheckCache();
  calls = [];
  handler = h;
}

const CREDS = { BC_API_BIN_USERNAME: 'bin-user', BC_API_BIN_PASSWORD: 's3cret' };
const DAY = '2026-10-29';

// Silence the (intentional) server error logs while failure paths are exercised.
const realError = console.error;
const errorLog: string[] = [];
console.error = (...args: unknown[]) => { errorLog.push(args.map(String).join(' ')); };

async function main() {
  console.log('Pure rules');

  await ok('OData escapes decode (_x0020_ = space)', () => {
    assert.equal(decodeODataText('Qty_x0020_Lower_x0020_Than_x0020_Bin'), 'Qty Lower Than Bin');
    assert.equal(decodeODataText('Plain'), 'Plain');
  });

  await ok('known statuses map to a reason; right ones are not wrong', () => {
    const wrong = (s: string, a: number | null = 1, b: number | null = 4) => judgeStatus(s, a, b);
    // "Not Scanned" is shown as "not found" — there is no separate "belum di-scan" any more.
    assert.deepEqual(wrong('Not_x0020_Scanned'), { wrong: true, reason: 'not_found', statusText: null });
    assert.deepEqual(wrong('Qty_x0020_Lower_x0020_Than_x0020_Bin'), { wrong: true, reason: 'qty_lower', statusText: null });
    assert.deepEqual(wrong('Qty_x0020_Higher_x0020_Than_x0020_Bin'), { wrong: true, reason: 'qty_higher', statusText: null });
    assert.deepEqual(wrong('Misplaced'), { wrong: true, reason: 'misplaced', statusText: null });
    assert.deepEqual(wrong('Not_x0020_Found'), { wrong: true, reason: 'not_found', statusText: null });
    assert.deepEqual(wrong('OK'), { wrong: false });
    assert.deepEqual(wrong(''), { wrong: false });
  });

  await ok('an unknown status is judged by the quantities', () => {
    assert.deepEqual(judgeStatus('Qty_x0020_Equal_x0020_To_x0020_Bin', 4, 4), { wrong: false });
    assert.deepEqual(judgeStatus('Something_x0020_New', 1, 4), { wrong: true, reason: 'unknown', statusText: 'Something New' });
    assert.deepEqual(judgeStatus('Something_x0020_New', null, null), { wrong: true, reason: 'unknown', statusText: 'Something New' });
  });

  await ok('item tokens split on the last hyphen; lists are pipe-separated', () => {
    assert.deepEqual(splitSkuToken('ASC1203A611.200-095'), { itemNo: 'ASC1203A611.200', variantCode: '095' });
    assert.deepEqual(splitSkuToken('A-B-XL'), { itemNo: 'A-B', variantCode: 'XL' });
    assert.deepEqual(splitSkuToken('NOVARIANT'), { itemNo: 'NOVARIANT', variantCode: '' });
    assert.deepEqual(splitSkuList('A-M|B-S|'), ['A-M', 'B-S']);
    assert.deepEqual(splitSkuList(''), []);
    assert.deepEqual(splitSkuList(undefined), []);
  });

  await ok('headers + summary → wrong items only, deduplicated, scoped to the store and checked bins', () => {
    const r = buildBinCheckIssues({ headers: HEADERS.value, summaries: SUMMARY.value, location: 'FF001', day: DAY });
    assert.equal(r.quantitiesAvailable, true);
    assert.equal(r.checkedBins, 1, 'only GDM1A1 was checked (GDM9Z9 unchecked, FF002 is another store)');
    assert.equal(r.okItems, 1, 'the OK line is counted, never listed');

    const byItem = new Map(r.issues.map((i) => [`${i.itemNo}-${i.variantCode}`, i]));
    assert.equal(r.issues.length, 5);
    assert.ok(!byItem.has('OKITEM-S') && !byItem.has('IGNORED-X') && !byItem.has('OTHERSTORE-'));

    const lower = byItem.get('SPE2010106-L')!;
    assert.equal(lower.reason, 'qty_lower');
    assert.equal(lower.scanQuantity, 1);
    assert.equal(lower.binQuantity, 4);
    assert.deepEqual(lower.correctBins, ['GDM1A1']);

    const notScanned = byItem.get('SPE2010107-M')!;
    assert.equal(notScanned.reason, 'not_found', 'BC "Not Scanned" → not found');
    assert.equal(notScanned.scanQuantity, 0, 'headers win over the summary duplicate (quantities kept)');

    const misplaced = byItem.get('PUM08447502-050')!;
    assert.deepEqual(misplaced.correctBins, ['GDM2B2'], 'the correct bin is actualBinCodes');
    assert.equal(misplaced.binCode, 'GDM1A1');
    assert.equal(misplaced.binCode, 'GDM1A1', '"Bin scan" = the bin that was checked');
    assert.equal(issueSku(lower), 'SPE2010106-L', 'SKU = item no with the variant behind it');
    assert.equal(issueSku({ itemNo: 'NOVARIANT', variantCode: '' }), 'NOVARIANT');

    // Items only the summary knows: listed, without quantities.
    const summaryOnly = byItem.get('B-S')!;
    assert.deepEqual([summaryOnly.itemNo, summaryOnly.variantCode, summaryOnly.reason], ['B', 'S', 'not_found']);
    assert.equal(summaryOnly.scanQuantity, null);
    const notFound = byItem.get('ASC1203A611.200-095')!;
    assert.deepEqual([notFound.itemNo, notFound.variantCode, notFound.reason], ['ASC1203A611.200', '095', 'not_found']);

    // Grouped by the "Bin benar" column, most serious first within a bin (the misplaced
    // item belongs in GDM2B2, so it follows the GDM1A1 rows).
    assert.deepEqual(r.issues.map((i) => i.reason), ['qty_lower', 'not_found', 'not_found', 'not_found', 'misplaced']);
    assert.deepEqual(r.issues.map((i) => i.correctBins[0]), ['GDM1A1', 'GDM1A1', 'GDM1A1', 'GDM1A1', 'GDM2B2']);
    // One table per reason, in the order the sections are shown.
    assert.deepEqual(groupIssuesByReason(r.issues).map((g) => [g.reason, g.issues.length]), [
      ['qty_lower', 1], ['misplaced', 1], ['not_found', 3],
    ]);
  });

  await ok('a real BC answer (FF001, 2026-11-10 shape): " " status = right, several correct bins, Not Scanned = not found', () => {
    const rl = (over: Record<string, unknown>) => ({
      date: '2026-11-10', location: 'FF001', unitOfMeasureCode: 'PCS', dateKey: '20261110', ...over,
    });
    const r = buildBinCheckIssues({
      headers: [
        {
          date: '2026-11-10', location: 'FF001', binCode: 'GDM1AI1', checked: true,
          ppBinContentCheckLines: [
            rl({ binCode: 'GDM1AI1', itemNo: 'ADIJR7922', variantCode: '040', unitOfMeasureCode: 'PRS', actualBinCodes: 'GDM1AI1', scanQuantity: 0, binQuantity: 2, binContentCheckStatus: 'Not_x0020_Scanned' }),
            rl({ binCode: 'GDM1AI1', itemNo: 'SPE2040034', variantCode: 'L', actualBinCodes: 'GDM1A3|GDM1B1|GDM1B2-D1', scanQuantity: 4, binQuantity: 14, binContentCheckStatus: 'Misplaced' }),
            rl({ binCode: 'GDM1AI1', itemNo: 'SPE2040034', variantCode: 'M', actualBinCodes: 'DISPLAY|GDM1A3|GDM1B1|GDM1B2-D1', scanQuantity: 1, binQuantity: 10, binContentCheckStatus: 'Misplaced' }),
          ],
        },
        {
          date: '2026-11-10', location: 'FF001', binCode: 'GDM1B1', checked: true,
          ppBinContentCheckLines: [
            // BC sends a single space (`_x0020_`) for a line that is right.
            rl({ binCode: 'GDM1B1', itemNo: 'SPE2040034', variantCode: 'L', actualBinCodes: 'GDM1B1', scanQuantity: 4, binQuantity: 4, binContentCheckStatus: '_x0020_' }),
            rl({ binCode: 'GDM1B1', itemNo: 'SPE2040034', variantCode: 'M', actualBinCodes: 'GDM1B1', scanQuantity: 1, binQuantity: 1, binContentCheckStatus: '_x0020_' }),
            rl({ binCode: 'GDM1B1', itemNo: 'SPE2040034', variantCode: 'S', actualBinCodes: 'GDM1B1', scanQuantity: 1, binQuantity: 1, binContentCheckStatus: '_x0020_' }),
            rl({ binCode: 'GDM1B1', itemNo: 'SPE2040034', variantCode: 'XL', actualBinCodes: 'GDM1B1', scanQuantity: 2, binQuantity: 3, binContentCheckStatus: 'Qty_x0020_Lower_x0020_Than_x0020_Bin' }),
            rl({ binCode: 'GDM1B1', itemNo: 'SPE2040036', variantCode: 'L', actualBinCodes: 'GDM1B1', scanQuantity: 0, binQuantity: 3, binContentCheckStatus: 'Not_x0020_Scanned' }),
          ],
        },
      ],
      summaries: [],
      location: 'FF001', day: '2026-11-10',
    });
    assert.equal(r.checkedBins, 2);
    assert.equal(r.okItems, 3, 'the three " " lines are right and never listed');
    assert.equal(r.issues.length, 5);
    assert.deepEqual(groupIssuesByReason(r.issues).map((g) => [g.reason, g.issues.length]), [
      ['qty_lower', 1], ['misplaced', 2], ['not_found', 2],
    ]);
    const m = r.issues.find((i) => i.itemNo === 'SPE2040034' && i.variantCode === 'M' && i.reason === 'misplaced')!;
    assert.deepEqual(m.correctBins, ['DISPLAY', 'GDM1A3', 'GDM1B1', 'GDM1B2-D1'], 'every bin of actualBinCodes, in order');
    assert.equal(m.binCode, 'GDM1AI1');
    assert.equal(m.scanQuantity, 1);
    assert.equal(m.binQuantity, 10);
  });

  await ok('everything right → no issues but the bins are still counted (all-clear, not "no data")', () => {
    const r = buildBinCheckIssues({
      headers: [{ date: DAY, location: 'FF001', binCode: 'GDM1A1', checked: true, ppBinContentCheckLines: [line({ binContentCheckStatus: 'OK', scanQuantity: 4 })] }],
      summaries: [{ date: DAY, location: 'FF001', binCode: 'GDM1A1', skuNotScanned: '' }],
      location: 'FF001', day: DAY,
    });
    assert.equal(r.issues.length, 0);
    assert.equal(r.checkedBins, 1);
    assert.equal(r.okItems, 1);
  });

  await ok('summary alone (headers feed down) still lists the wrong items, without quantities', () => {
    const r = buildBinCheckIssues({ headers: null, summaries: SUMMARY.value, location: 'FF001', day: DAY });
    assert.equal(r.quantitiesAvailable, false);
    assert.ok(r.issues.length >= 4);
    assert.ok(r.issues.every((i) => i.scanQuantity === null && i.binQuantity === null));
  });

  await ok('rows of another day are ignored', () => {
    const r = buildBinCheckIssues({
      headers: [{ date: '2026-10-28', location: 'FF001', binCode: 'GDM1A1', checked: true, ppBinContentCheckLines: [line({})] }],
      summaries: null, location: 'FF001', day: DAY,
    });
    assert.equal(r.checkedBins, 0);
    assert.equal(r.issues.length, 0);
  });

  console.log('Server module');

  await ok('URLs: base, $expand, $schemaversion and the store + day $filter', () => {
    const base = BC_BIN_CHECK_DEFAULT_BASE_URL;
    assert.ok(base.endsWith('companies(fdc329b5-9a4a-ed11-ac38-81e458651713)/'));
    const h = binCheckHeadersUrl(base, "FF0'01", DAY);
    assert.ok(h.startsWith(`${base}ppBinContentCheckHeaders?`));
    assert.ok(h.includes('$expand=ppBinContentCheckLines'));
    assert.ok(h.includes('$schemaversion=2.0'));
    assert.equal(
      decodeURIComponent(h.split('$filter=')[1]),
      "location eq 'FF0''01' and date ge 2026-10-29 and date lt 2026-10-30",
      'quote escaped, next day exclusive',
    );
    const s = binCheckSummaryUrl(base, 'FF001', '2026-12-31');
    assert.ok(s.startsWith(`${base}ppBinContentChecks?`));
    assert.ok(!s.includes('$expand'));
    assert.ok(decodeURIComponent(s).includes('date lt 2027-01-01'), 'crosses the year');
  });

  await ok('no credentials → "not_configured", BC is never called, nothing throws', async () => {
    for (const env of [{}, { BC_API_BIN_USERNAME: 'u' }, { BC_API_BIN_USERNAME: ' ', BC_API_BIN_PASSWORD: '' }]) {
      reset(env);
      const r = await getBinCheckResult({ location: 'FF001', day: DAY });
      assert.equal(r.state, 'not_configured');
      assert.deepEqual(r.issues, []);
      assert.equal(calls.length, 0);
    }
    assert.equal(resolveBinCheckConfig({} as NodeJS.ProcessEnv), null);
    assert.ok(errorLog.some((l) => l.includes('BC_API_BIN_USERNAME')), 'a clear server log line');
  });

  await ok('credentials → both feeds are requested with Basic auth and the store/day filter', async () => {
    reset(CREDS);
    const r = await getBinCheckResult({ location: 'FF001', day: DAY });
    assert.equal(r.state, 'ok');
    assert.equal(r.checkedBins, 1);
    assert.equal(r.issues.length, 5);
    assert.ok(r.fetchedAt);
    assert.equal(calls.length, 2);
    const expected = `Basic ${Buffer.from('bin-user:s3cret').toString('base64')}`;
    assert.ok(calls.every((c) => c.auth === expected));
    assert.ok(calls.some((c) => c.url.includes('/ppBinContentCheckHeaders?') && c.url.includes('$expand=ppBinContentCheckLines')));
    assert.ok(calls.every((c) => decodeURIComponent(c.url).includes("location eq 'FF001' and date ge 2026-10-29 and date lt 2026-10-30")));
    assert.ok(calls.every((c) => c.url.startsWith(BC_BIN_CHECK_DEFAULT_BASE_URL)));
    assert.ok(!JSON.stringify(r).includes('s3cret'), 'no secret in the result');
  });

  await ok('a second call is served from the short cache; "force" cannot hammer BC', async () => {
    reset(CREDS);
    await getBinCheckResult({ location: 'FF001', day: DAY });
    await getBinCheckResult({ location: 'ff001', day: DAY });
    await getBinCheckResult({ location: 'FF001', day: DAY, force: true });
    assert.equal(calls.length, 2, 'one pair of requests in total');
    await getBinCheckResult({ location: 'FF002', day: DAY });
    assert.equal(calls.length, 4, 'another store is its own entry');
  });

  await ok('BC rejects the login → "unavailable", logged, not cached', async () => {
    reset(CREDS, () => json({ error: { message: 'Unauthorized' } }, 401));
    errorLog.length = 0;
    const r = await getBinCheckResult({ location: 'FF001', day: DAY });
    assert.equal(r.state, 'unavailable');
    assert.deepEqual(r.issues, []);
    assert.ok(errorLog.some((l) => l.includes('[bin-check]') && l.includes('401')));
    handler = happy;
    const again = await getBinCheckResult({ location: 'FF001', day: DAY });
    assert.equal(again.state, 'ok', 'the failure was not remembered');
  });

  await ok('headers feed down, summary up → still ok, flagged "no quantities"', async () => {
    reset(CREDS, (url) => (url.includes('/ppBinContentCheckHeaders?') ? new Response('boom', { status: 500 }) : json(SUMMARY)));
    const r = await getBinCheckResult({ location: 'FF001', day: DAY });
    assert.equal(r.state, 'ok');
    assert.equal(r.quantitiesAvailable, false);
    assert.ok(r.issues.length >= 4);
  });

  await ok('summary feed down, headers up → ok with quantities', async () => {
    reset(CREDS, (url) => (url.includes('/ppBinContentChecks?') ? new Response('boom', { status: 503 }) : json(HEADERS)));
    const r = await getBinCheckResult({ location: 'FF001', day: DAY });
    assert.equal(r.state, 'ok');
    assert.equal(r.quantitiesAvailable, true);
    assert.equal(r.issues.length, 3);
  });

  await ok('garbage payloads and network errors never throw', async () => {
    reset(CREDS, () => json({ value: 'not-an-array' }));
    let r = await getBinCheckResult({ location: 'FF001', day: DAY });
    assert.equal(r.state, 'ok');
    assert.equal(r.checkedBins, 0, 'no scan data = the "belum ada hasil" state, not an error');

    reset(CREDS, () => { throw new TypeError('fetch failed'); });
    r = await getBinCheckResult({ location: 'FF001', day: DAY });
    assert.equal(r.state, 'unavailable');

    reset(CREDS, () => new Response('<html>nope</html>', { status: 200 }));
    r = await getBinCheckResult({ location: 'FF001', day: DAY });
    assert.equal(r.state, 'unavailable');

    r = await getBinCheckResult({ location: 'FF001', day: 'not-a-day' });
    assert.equal(r.state, 'unavailable');
  });

  await ok('@odata.nextLink pages are followed', async () => {
    reset(CREDS, (url) => {
      if (url.includes('/ppBinContentChecks?')) return json({ value: [] });
      if (url.includes('page=2')) return json({ value: [HEADERS.value[2]] });
      return json({ value: [HEADERS.value[0]], '@odata.nextLink': `${url.split('?')[0]}?page=2` });
    });
    const r = await getBinCheckResult({ location: 'FF001', day: DAY });
    assert.equal(r.state, 'ok');
    assert.equal(r.issues.length, 3);
    assert.equal(calls.filter((c) => c.url.includes('ppBinContentCheckHeaders')).length, 2);
  });

  await ok('BC_API_BIN_BASE_URL overrides the UAT base (trailing slash added)', async () => {
    reset({ ...CREDS, BC_API_BIN_BASE_URL: 'https://bc.example.test/PROD/api/x/v1.0/companies(abc)' });
    await getBinCheckResult({ location: 'FF001', day: DAY });
    assert.ok(calls.every((c) => c.url.startsWith('https://bc.example.test/PROD/api/x/v1.0/companies(abc)/ppBinContent')));
  });

  await ok('BC_API_BIN_BASE_URL may be a full entity URL pasted from Postman — it is cut back to the company root', async () => {
    const root = 'https://bc.example.test/UAT/api/x/v1.0/companies(abc)/';
    const pasted = [
      `${root}ppBinContentCheckHeaders?$expand=ppBinContentCheckLines&$schemaversion=2.0`,
      `"${root}ppBinContentCheckHeaders?$expand=ppBinContentCheckLines&$schemaversion=2.0"`,
      `${root}ppBinContentCheckHeaders?=ppBinContentCheckLines&=2.0`, // what an env loader leaves after eating `$…`
      `${root}ppBinContentChecks`,
      `${root}ppBinContentChecks/`,
      `${root}?$schemaversion=2.0`,
      root,
      root.slice(0, -1),
    ];
    for (const p of pasted) assert.equal(normalizeBinCheckBaseUrl(p), root, p);

    reset({ ...CREDS, BC_API_BIN_BASE_URL: pasted[0] });
    const r = await getBinCheckResult({ location: 'FF001', day: DAY });
    assert.equal(r.state, 'ok');
    assert.equal(calls.length, 2);
    assert.ok(calls.some((c) => c.url.startsWith(`${root}ppBinContentCheckHeaders?$expand=ppBinContentCheckLines&`)));
    assert.ok(calls.some((c) => c.url.startsWith(`${root}ppBinContentChecks?`)));
    assert.ok(calls.every((c) => !c.url.includes('?=') && (c.url.match(/ppBinContentCheck/g) ?? []).length <= 2 && c.url.split('?').length === 2));
  });

  await ok('a hung BC request is cut off by the shared client timeout', async () => {
    reset(CREDS);
    globalThis.fetch = ((_: RequestInfo | URL, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
      })) as typeof fetch;
    const t0 = Date.now();
    // AbortSignal.timeout's own timer is unref'd (a live server keeps running anyway);
    // hold the script open until it fires.
    const keepAlive = setTimeout(() => {}, 5_000);
    try {
      await assert.rejects(
        fetchAllBusinessCentralRows('https://bc.example.test/x', { apiUrl: '', authType: 'basic', username: 'u', password: 'p', source: 'env' }, { timeoutMs: 60 }),
        /timed out after 60 ms/,
      );
    } finally {
      clearTimeout(keepAlive);
    }
    assert.ok(Date.now() - t0 < 2_000);
  });

  // ── The real fetch module against the seeded mock BC, over real HTTP ──────
  console.log('Over real HTTP (seeded mock BC)');
  globalThis.fetch = realFetch;
  const { server, baseUrl } = await startMockBinCheckServer(0, { username: 'bin-user', password: 's3cret' });
  try {
    await ok('seeded scenario: 4 bins checked, only the wrong items listed (15), the unchecked bin hidden', async () => {
      reset({ ...CREDS, BC_API_BIN_BASE_URL: baseUrl });
      const r = await getBinCheckResult({ location: 'FF001', day: DAY });
      assert.equal(r.state, 'ok');
      assert.equal(r.checkedBins, 4, 'GDM1A1, GDM1A2, GDM2B1, GDM3C3 — GDM9Z9 was never scanned');
      assert.equal(r.okItems, 4);
      assert.equal(r.issues.length, 15);
      assert.ok(!r.issues.some((i) => i.itemNo === 'SHOULDNOTSHOW'));
      assert.ok(!r.issues.some((i) => i.binCode === 'GDM1A2'), 'the fully correct bin lists nothing');
      assert.ok(!r.issues.some((i) => i.itemNo === 'NIK1000231'), 'a correct line is never listed');
      // "Not Scanned" (10) and "Not Found" (2) are one section: 12 items not found.
      assert.deepEqual(
        groupIssuesByReason(r.issues).map((g) => [g.reason, g.issues.length]),
        [['qty_lower', 1], ['qty_higher', 1], ['misplaced', 1], ['not_found', 12]],
      );
      const misplaced = r.issues.find((i) => i.reason === 'misplaced')!;
      assert.deepEqual(misplaced.correctBins, ['GDM2B2']);
      const summaryOnly = r.issues.find((i) => i.itemNo === 'ASC9999999')!;
      assert.equal(summaryOnly.scanQuantity, null, 'listed by the summary feed only → no quantities');
    });

    await ok('any store and day gets the scenario echoed back (location + date come from the $filter)', async () => {
      reset({ ...CREDS, BC_API_BIN_BASE_URL: baseUrl });
      const r = await getBinCheckResult({ location: 'FF002', day: '2026-11-09' });
      assert.equal(r.state, 'ok');
      assert.equal(r.location, 'FF002');
      assert.equal(r.day, '2026-11-09');
      assert.equal(r.issues.length, 15);
    });

    await ok('wrong Basic credentials → the mock answers 401 → "unavailable", nothing thrown', async () => {
      reset({ BC_API_BIN_USERNAME: 'bin-user', BC_API_BIN_PASSWORD: 'wrong', BC_API_BIN_BASE_URL: baseUrl });
      const r = await getBinCheckResult({ location: 'FF001', day: DAY });
      assert.equal(r.state, 'unavailable');
      assert.deepEqual(r.issues, []);
    });
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

main()
  .then(() => {
    console.error = realError;
    globalThis.fetch = realFetch;
    console.log(`\n${checks} checks passed`);
  })
  .catch((err) => {
    console.error = realError;
    console.error(err);
    process.exit(1);
  });
