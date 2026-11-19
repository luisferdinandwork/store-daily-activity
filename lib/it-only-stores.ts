// lib/it-only-stores.ts
// ─────────────────────────────────────────────────────────────────────────────
// IT-only (test) stores — client-safe rule.
//
// A store whose code starts with "DUMMY" (the seed's DUMMY-001) is a test store:
// only IT sees it. Ops HO, Finance, Audit, Ops Area of other areas and staff of
// other stores never see it — not in lists, rollups, reports, pickers or
// notifications. The store's own test accounts (its staff, the Ops Area of its
// area) keep working, and IT previewing another role (Switch Role) still sees it.
//
// Server side: lib/db/utils/it-only-stores.ts (which ids are hidden from the
// signed-in viewer + SQL helpers).
// ─────────────────────────────────────────────────────────────────────────────

export const IT_ONLY_STORE_PREFIX = 'DUMMY';

/** True for a test store's code (DUMMY-001, dummy-002, …). */
export function isItOnlyStoreNo(storeNo: string | null | undefined): boolean {
  return !!storeNo && storeNo.trim().toUpperCase().startsWith(IT_ONLY_STORE_PREFIX);
}

/** The viewer fields the rule needs (a subset of session.user). */
export type ItOnlyViewer = {
  role?: string | null;
  switchedFromRoleCode?: string | null;
  homeStoreId?: number | null;
  areaId?: number | null;
};

/** The IT-only store ids + the areas made of nothing but IT-only stores. */
export type ItOnlySet = { storeIds: readonly number[]; areaIds: readonly number[] };

/**
 * May this viewer see the IT-only stores?
 *   - IT, or IT previewing another role (Switch Role)       → yes
 *   - a test account of the store itself (home store / area) → yes (their own scope)
 *   - everyone else                                           → no
 */
export function viewerSeesItOnlyStores(viewer: ItOnlyViewer, set: ItOnlySet): boolean {
  if (viewer.role === 'it' || viewer.switchedFromRoleCode === 'it') return true;
  if (viewer.homeStoreId != null && set.storeIds.includes(viewer.homeStoreId)) return true;
  if (viewer.areaId != null && set.areaIds.includes(viewer.areaId)) return true;
  return false;
}
