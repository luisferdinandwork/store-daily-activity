// scripts/seed-business-central-settings.ts
import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: '.env' });

import { db } from '@/lib/db';
import { businessCentralSettings } from '@/lib/db/schema';

const apiUrl =
  process.env.BC_SALES_ENTRIES_URL ??
  'https://bc.panatradeprestasi.com:7248/UAT/api/panatradeprestasi/pntpri/v1.0/companies(fdc329b5-9a4a-ed11-ac38-81e458651713)/ppQueryTransSalesEntries?$schemaversion=2.0';

const username = process.env.BC_API_USERNAME ?? process.env.BC_USERNAME ?? '';
const password = process.env.BC_API_PASSWORD ?? process.env.BC_PASSWORD ?? '';

async function main() {
  if (!username || !password) {
    throw new Error(
      'Missing BC credentials. Set BC_API_USERNAME and BC_API_PASSWORD in .env.local first.',
    );
  }

  await db.delete(businessCentralSettings);

  await db.insert(businessCentralSettings).values({
    code: 'sales_entries',
    name: 'Business Central Sales Entries',
    apiUrl,
    username,
    password,
    authType: 'basic',
    isActive: true,
  });

  console.log('✅ Business Central settings seeded from env into DB.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ seed-business-central-settings failed:', err);
    process.exit(1);
  });
