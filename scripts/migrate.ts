// scripts/migrate.ts
import { execSync } from 'child_process';
import { config } from 'dotenv';

config({ path: '.env.local' });

async function main() {
  try {
    console.log('⏳ Running database migrations...');
    execSync('drizzle-kit migrate', { stdio: 'inherit' });
    console.log('✅ Migrations completed successfully!');
  } catch (error) {
    console.error('❌ Error running migrations:');
    process.exit(1);
  }
}

main();