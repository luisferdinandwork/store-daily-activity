// lib/store-pic1.ts
//
// "One PIC 1 per store" — pure + client-safe (no DB).
//
// PIC 1 is the store's petty-cash holder (isPettyCashHolder in
// lib/db/utils/petty-cash-refill.ts), takes the PIC1 target slot (a second one
// is demoted to SA by addAllStoreStaffToRoster) and is who Finance chases for
// refill bank details (petty-cash-report.ts). A store with two of them has two
// people holding the same cash box. Writes don't refuse it — a handover briefly
// needs both, and an Excel import lands rows one at a time — so the IT Users
// page, Store Management and the import review flag it in red instead and
// IT changes one of them to PIC 2 / SA.

/** employee_types.code of a store's primary PIC. */
export const PIC_1_TYPE_CODE = 'pic_1';

export interface Pic1Facts<K> {
  /** The store the person belongs to (an id, a code — anything Map-keyable). */
  storeKey: K | null | undefined;
  employeeTypeCode: string | null | undefined;
  isActive: boolean;
}

/**
 * Groups active PIC 1s by store and keeps only the stores that have more than
 * one. `read` maps each caller's row shape onto the facts the rule needs.
 */
export function findDuplicatePic1<T, K>(
  people: Iterable<T>,
  read: (person: T) => Pic1Facts<K>,
): Map<K, T[]> {
  const byStore = new Map<K, T[]>();
  for (const person of people) {
    const { storeKey, employeeTypeCode, isActive } = read(person);
    if (!isActive || storeKey == null || employeeTypeCode !== PIC_1_TYPE_CODE) continue;
    const list = byStore.get(storeKey);
    if (list) list.push(person);
    else byStore.set(storeKey, [person]);
  }
  for (const [storeKey, list] of byStore) {
    if (list.length < 2) byStore.delete(storeKey);
  }
  return byStore;
}
