// scripts/generate.ts
import { execSync } from 'child_process';
import { config } from 'dotenv';

// Load environment variables from .env.local
config({ path: '.env.local' });

async function main() {
  try {
    console.log('🚀 Generating new migration file...');
    // The 'stdio: inherit' option pipes the output directly to your terminal
    execSync('drizzle-kit generate', { stdio: 'inherit' });
    console.log('✅ Migration file generated successfully!');
  } catch (error) {
    console.error('❌ Error generating migration:');
    process.exit(1);
  }
}

main();