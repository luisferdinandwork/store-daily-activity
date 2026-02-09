// scripts/reset.ts
import { config } from 'dotenv';
import { neon } from '@neondatabase/serverless';

config({ path: '.env.local' });

if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL is not set');
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL!);

async function resetDatabase() {
  try {
    console.log('Resetting database...');
    
    // Drop everything in public schema
    await sql`
      DO $$       DECLARE
        r RECORD;
      BEGIN
        -- Drop all tables
        FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
          EXECUTE 'DROP TABLE IF EXISTS ' || quote_ident(r.tablename) || ' CASCADE';
        END LOOP;
        
        -- Drop all types
        FOR r IN (SELECT typname FROM pg_type WHERE typtype = 'e' AND typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')) LOOP
          EXECUTE 'DROP TYPE IF EXISTS ' || quote_ident(r.typname) || ' CASCADE';
        END LOOP;
        
        -- Drop migration table
        EXECUTE 'DROP TABLE IF EXISTS "__drizzle_migrations" CASCADE';
      END $$;
    `;
    
    console.log('✅ Database reset complete!');
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

resetDatabase();