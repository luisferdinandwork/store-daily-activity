// lib/db/utils/it-only-stores.ts
// ─────────────────────────────────────────────────────────────────────────────
// Server side of the IT-only (test) store rule — see lib/it-only-stores.ts.
//
//   const hidden = await getHiddenStores();          // for the signed-in viewer
//   .where(and(…, notHiddenStore(stores.id, hidden.storeIds)))
//   rows.filter((r) => !hidden.storeIds.includes(r.storeId))
//
// `getHiddenStores()` reads the session itself, so list helpers deep in lib/ can
// call it without threading the viewer through. It hides nothing when:
//   • the viewer may see the test stores (IT, IT previewing, the store's own
//     test accounts — viewerSeesItOnlyStores), or
//   • there is no signed-in user (cron jobs, scripts, public pages) — those are
//     system work and must keep covering every store.
// Use it ONLY on read/list paths, never inside business logic that writes.
// ─────────────────────────────────────────────────────────────────────────────

import { eq, inArray, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { AnyColumn } from 'drizzle-orm';
import { getServerSession } from 'next-auth';

import { db } from '@/lib/db';
import { userRoles, users } from '@/lib/db/schema';
import {
  IT_ONLY_STORE_PREFIX,
  viewerSeesItOnlyStores,
  type ItOnlySet,
  type ItOnlyViewer,
} from '@/lib/it-only-stores';

export type HiddenStores = {
  /** Store ids this viewer must not see (empty = nothing hidden). */
  storeIds: number[];
  /** Areas made only of hidden stores (e.g. "DUMMY AREA"). */
  areaIds: number[];
};

const NOTHING_HIDDEN: HiddenStores = { storeIds: [], areaIds: [] };

const TTL_MS = 60_000;
let cached: { at: number; set: { storeIds: number[]; areaIds: number[] } } | null = null;
let inflight: Promise<{ storeIds: number[]; areaIds: number[] }> | null = null;

/** Every IT-only store id + the areas that hold nothing else (cached 60 s). */
export async function getItOnlySet(): Promise<{ storeIds: number[]; areaIds: number[] }> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.set;
  if (inflight) return inflight;

  const pattern = `${IT_ONLY_STORE_PREFIX}%`;
  inflight = (async () => {
    try {
      const [storeRows, areaRows] = await Promise.all([
        db.execute<{ id: number }>(sql`
          SELECT id FROM stores WHERE upper(trim(store_no)) LIKE ${pattern}
        `),
        db.execute<{ area_id: number }>(sql`
          SELECT area_id FROM stores
          GROUP BY area_id
          HAVING bool_and(upper(trim(store_no)) LIKE ${pattern})
        `),
      ]);
      const set = {
        storeIds: storeRows.rows.map((r) => Number(r.id)),
        areaIds: areaRows.rows.map((r) => Number(r.area_id)),
      };
      cached = { at: Date.now(), set };
      return set;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** The signed-in user, or null outside a request / when signed out. */
async function currentViewer(): Promise<ItOnlyViewer | null> {
  try {
    // Imported lazily: lib/auth → role-preview → schedule-utils → here would be a cycle.
    const { authOptions } = await import('@/lib/auth');
    const session = await getServerSession(authOptions);
    const u = session?.user;
    if (!u?.id) return null;
    return {
      role: u.role ?? null,
      switchedFromRoleCode: u.switchedFromRoleCode ?? null,
      homeStoreId: u.homeStoreId ?? null,
      areaId: u.areaId ?? null,
    };
  } catch {
    // cookies() outside a request scope (scripts, background work) → system.
    return null;
  }
}

/**
 * What the viewer must not see. Pass `viewer` when the route already has the
 * session user; omit it to read the session here.
 */
export async function getHiddenStores(viewer?: ItOnlyViewer | null): Promise<HiddenStores> {
  const who = viewer === undefined ? await currentViewer() : viewer;
  if (!who) return NOTHING_HIDDEN;

  const set: ItOnlySet = await getItOnlySet();
  if (set.storeIds.length === 0) return NOTHING_HIDDEN;
  if (viewerSeesItOnlyStores(who, set)) return NOTHING_HIDDEN;

  return { storeIds: [...set.storeIds], areaIds: [...set.areaIds] };
}

/** True when the signed-in viewer must not see this store. */
export async function isStoreHidden(storeId: number | null | undefined): Promise<boolean> {
  if (storeId == null) return false;
  const hidden = await getHiddenStores();
  return hidden.storeIds.includes(Number(storeId));
}

/**
 * `col` is not one of the hidden ids (NULL passes — a back-office user with no
 * home store, a row with no store). `TRUE` when nothing is hidden, so it can go
 * into drizzle's `and(…)` or a `conditions` array as is.
 */
export function notHiddenStore(col: AnyColumn | SQL, ids: readonly number[]): SQL {
  if (ids.length === 0) return sql`TRUE`;
  const list = sql.join(ids.map((id) => sql`${id}`), sql`, `);
  return sql`(${col} IS NULL OR ${col} NOT IN (${list}))`;
}

/** Same as notHiddenStore() for an area id column. */
export function notHiddenArea(col: AnyColumn | SQL, ids: readonly number[]): SQL {
  return notHiddenStore(col, ids);
}

/** Raw-SQL twin of notHiddenStore() for db.execute(sql`…`) queries. */
export function notHiddenStoreSql(colSql: SQL, ids: readonly number[]): SQL {
  if (ids.length === 0) return sql`TRUE`;
  return sql`(${colSql} IS NULL OR ${colSql} NOT IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)}))`;
}

/** Keep only rows whose store is visible. */
export function withoutHiddenStores<T>(
  rows: readonly T[],
  hidden: HiddenStores,
  storeIdOf: (row: T) => number | null | undefined,
): T[] {
  if (hidden.storeIds.length === 0) return [...rows];
  return rows.filter((r) => {
    const id = storeIdOf(r);
    return id == null || !hidden.storeIds.includes(Number(id));
  });
}

/**
 * Recipients of an event at `storeId`: everyone when it is a normal store; for an
 * IT-only store only the users who may see it (IT, IT previewing, the store's own
 * test accounts) — Ops HO / Finance / Audit never get its notifications or emails.
 */
export async function onlyUsersWhoSeeStore(
  userIds: readonly string[],
  storeId: number | null | undefined,
): Promise<string[]> {
  const ids = [...new Set(userIds)];
  if (!ids.length || storeId == null) return ids;

  const set = await getItOnlySet();
  if (!set.storeIds.includes(Number(storeId))) return ids;

  const fromRole = alias(userRoles, 'it_only_from_role');
  const rows = await db
    .select({
      id: users.id,
      role: userRoles.code,
      switchedFromRoleCode: fromRole.code,
      homeStoreId: users.homeStoreId,
      areaId: users.areaId,
    })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.id, users.roleId))
    .leftJoin(fromRole, eq(fromRole.id, users.switchedFromRoleId))
    .where(inArray(users.id, ids));

  return rows.filter((r) => viewerSeesItOnlyStores(r, set)).map((r) => r.id);
}

/** True when `areaId` holds nothing but IT-only stores (e.g. "DUMMY AREA"). */
export async function isItOnlyArea(areaId: number | null | undefined): Promise<boolean> {
  if (areaId == null) return false;
  return (await getItOnlySet()).areaIds.includes(Number(areaId));
}
