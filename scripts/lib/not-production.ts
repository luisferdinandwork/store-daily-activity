// scripts/lib/not-production.ts
//
// Side-effect import: put it FIRST in any script that wipes or seeds data.
//
//   import '../lib/not-production';   // (or './lib/not-production')
//
// Exits if DATABASE_URL points at production. Production is whatever
// PRODUCTION_DATABASE_URL in .env.local says; on the server itself that
// variable doesn't exist, so NODE_ENV=production is refused too.
//
// Deliberate override for a one-off, e.g. bootstrapping a fresh database:
//   ALLOW_PRODUCTION_DB=1 npm run <script>

import { config } from 'dotenv';
import { describeTarget, sameDatabase } from './db-target';

config({ path: '.env.local' });
config({ path: '.env' });

const url = process.env.DATABASE_URL;
const prod = process.env.PRODUCTION_DATABASE_URL;

const looksLikeProduction =
  process.env.NODE_ENV === 'production' || (!!url && !!prod && sameDatabase(url, prod));

if (looksLikeProduction && process.env.ALLOW_PRODUCTION_DB !== '1') {
  console.error(
    `\n⛔ Refusing to run: DATABASE_URL points at PRODUCTION (${url ? describeTarget(url) : 'NODE_ENV=production'}).\n` +
      '   This script deletes or seeds data. Point DATABASE_URL at staging in .env.local,\n' +
      '   or, if you really mean it, re-run with ALLOW_PRODUCTION_DB=1.\n',
  );
  process.exit(1);
}
