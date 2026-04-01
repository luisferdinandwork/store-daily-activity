// lib/db/schema/index.ts
// ─────────────────────────────────────────────────────────────────────────────
// Barrel export — import from '@/lib/db/schema' as before.
// ─────────────────────────────────────────────────────────────────────────────

export * from './enums';
export * from './core';
export * from './tasks';

// ── Convenience re-export of the full schema object used by Drizzle ───────────
import * as enums  from './enums';
import * as core   from './core';
import * as tasks  from './tasks';

export const schema = { ...enums, ...core, ...tasks };