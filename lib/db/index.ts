// lib/db/index.ts
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool }    from 'pg';
import { schema }  from './schema';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set');
}

// Plain node-postgres pool against a self-hosted PostgreSQL server.
// `pg` reads sslmode from the connection string; a local/VPN Postgres
// without TLS just omits it. Set `?sslmode=require` in DATABASE_URL if
// the server terminates TLS.
const globalForDb = globalThis as unknown as { __pgPool?: Pool };

export const pool =
  globalForDb.__pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
  });

if (process.env.NODE_ENV !== 'production') globalForDb.__pgPool = pool;

export const db = drizzle(pool, { schema });
