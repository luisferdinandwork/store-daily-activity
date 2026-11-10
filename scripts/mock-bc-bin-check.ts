// scripts/mock-bc-bin-check.ts
// Seeded stand-in for the BC PP Bin Content Check feeds, so Cek Bin · "Hasil scan BC"
// can be tried without BC credentials. Nothing is written to the database — the real
// feature reads BC live, so the "seed" is this fake BC.
//
//   npm run mock:bc-bin
//
// then in .env.local (restart the dev server afterwards):
//
//   BC_API_BIN_BASE_URL=http://127.0.0.1:4010/
//   BC_API_BIN_USERNAME=mock
//   BC_API_BIN_PASSWORD=mock
//
// Every store and day gets the same scenario (see scripts/lib/mock-bc-bin-check.ts).
// To go back to real BC: remove the three lines (or restore your own values) and restart.

import { startMockBinCheckServer, SAMPLE_BINS } from './lib/mock-bc-bin-check';

const port = Number(process.env.MOCK_BC_PORT) || 4010;

startMockBinCheckServer(port).then(({ baseUrl }) => {
  console.log(`Mock BC (bin content check) listening on ${baseUrl}`);
  console.log('');
  console.log('Seeded result for any store/day:');
  for (const b of SAMPLE_BINS) {
    const wrong = b.lines.filter((l) => l.status !== 'OK');
    console.log(
      `  ${b.binCode.padEnd(7)} ${b.checked ? 'checked  ' : 'NOT scanned'}  ${b.lines.length} items, ${wrong.length} wrong` +
        (b.checked && wrong.length === 0 ? '  (all correct)' : '') +
        (!b.checked ? '  (must stay hidden)' : ''),
    );
  }
  console.log('');
  console.log('Put these in .env.local and restart `npm run dev`:');
  console.log(`  BC_API_BIN_BASE_URL=${baseUrl}`);
  console.log('  BC_API_BIN_USERNAME=mock');
  console.log('  BC_API_BIN_PASSWORD=mock');
  console.log('');
  console.log('Ctrl-C to stop.');
}).catch((err) => {
  console.error(`Could not start the mock BC on port ${port}:`, err instanceof Error ? err.message : err);
  process.exit(1);
});
