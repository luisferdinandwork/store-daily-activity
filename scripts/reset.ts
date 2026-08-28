// scripts/reset.ts
import { config } from 'dotenv';
import { Pool } from 'pg';

config({ path: '.env.local' });
config({ path: '.env' });

if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL is not set');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function resetDatabase() {
  try {
    console.log('Resetting database...');

    // Drop everything in the public schema (tables, enum types, and the
    // drizzle migration bookkeeping table) in one server-side DO block.
    await pool.query(`
      DO $$
      DECLARE
        r RECORD;
      BEGIN
        -- Drop all tables
        FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
          EXECUTE 'DROP TABLE IF EXISTS ' || quote_ident(r.tablename) || ' CASCADE';
        END LOOP;

        -- Drop all enum types
        FOR r IN (
          SELECT typname FROM pg_type
          WHERE typtype = 'e'
            AND typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
        ) LOOP
          EXECUTE 'DROP TYPE IF EXISTS ' || quote_ident(r.typname) || ' CASCADE';
        END LOOP;

        -- Drop drizzle's migration bookkeeping. node-postgres keeps it in a
        -- dedicated "drizzle" schema; older/neon setups used public.
        EXECUTE 'DROP TABLE IF EXISTS "__drizzle_migrations" CASCADE';
        EXECUTE 'DROP SCHEMA IF EXISTS "drizzle" CASCADE';
      END $$;
    `);

    console.log('✅ Database reset complete!');
  } catch (error) {
    console.error('❌ Error:', error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

resetDatabase();
