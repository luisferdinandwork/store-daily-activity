// scripts/lib/db-target.ts
//
// Which database is a connection string pointing at? Used by the production
// migrate script and by the guard that stops destructive scripts (reset, seed)
// from running against production.
//
// .env.local layout (see CLAUDE.md → Environments):
//   DATABASE_URL             the database you develop against (staging)
//   PRODUCTION_DATABASE_URL  production — only scripts/migrate-prod.ts uses it

export interface DbTarget {
  user: string;
  host: string;
  port: string;
  database: string;
}

export function parseTarget(url: string): DbTarget {
  const u = new URL(url);
  return {
    user: decodeURIComponent(u.username),
    host: u.hostname,
    port: u.port || '5432',
    database: decodeURIComponent(u.pathname.replace(/^\//, '')),
  };
}

/** "user@host:port/database" — never includes the password. */
export function describeTarget(url: string): string {
  const t = parseTarget(url);
  return `${t.user}@${t.host}:${t.port}/${t.database}`;
}

/** Same server + database (the login user doesn't matter). */
export function sameDatabase(a: string, b: string): boolean {
  const x = parseTarget(a);
  const y = parseTarget(b);
  return x.host === y.host && x.port === y.port && x.database === y.database;
}
