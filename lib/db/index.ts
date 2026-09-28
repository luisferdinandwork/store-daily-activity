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
    // One PM2 fork process serves everyone; pages fire several API calls in
    // parallel, each running queries concurrently (Promise.all), so 10 queued.
    max: 20,
    // A fresh connection costs ~3 round trips (+TLS) to the DB host. pg's
    // default drops idle clients after 10s, so a user tapping between pages
    // kept paying that setup. Keep them warm for 5 min instead.
    idleTimeoutMillis: 5 * 60_000,
    keepAlive: true,
    // Fail fast instead of hanging a request forever if the DB is unreachable.
    connectionTimeoutMillis: 10_000,
  });

if (process.env.NODE_ENV !== 'production') globalForDb.__pgPool = pool;

export const db = drizzle(pool, { schema });
