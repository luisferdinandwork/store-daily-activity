// scripts/db-check.ts
//
// Quick connectivity check — connects with the exact driver and DATABASE_URL
// the app uses, runs a trivial query, and prints server/db/user info.
//
//   npm run db:check
//
import { config } from 'dotenv';
import { Pool } from 'pg';

config({ path: '.env.local' });
config({ path: '.env' });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('❌ DATABASE_URL is not set (.env.local)');
  process.exit(1);
}

// Show where we're pointing without leaking the password.
console.log(`→ connecting to ${url.replace(/:\/\/([^:]+):[^@]*@/, '://$1:***@')}`);

const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 8000 });

pool
  .query(
    `select current_database() as db,
            current_user       as "user",
            inet_server_addr()  as host,
            version()           as version`,
  )
  .then((r) => {
    const row = r.rows[0];
    console.log('✅ connected');
    console.log(`   database : ${row.db}`);
    console.log(`   user     : ${row.user}`);
    console.log(`   host     : ${row.host ?? '(local socket)'}`);
    console.log(`   server   : ${String(row.version).split(',')[0]}`);
  })
  .catch((err) => {
    console.error('❌ connection failed');
    console.error(`   ${err.code ? `[${err.code}] ` : ''}${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
