// lib/finance/code-groups.ts
// Grouping of store rows by store code (FF / FS / FO / ODD / SS …) — the
// "By Store Code" view shared by Finance's sheet pages. Client-safe.

import {
  compareStoreCodes,
  storeCodeBrand,
  storeCodeDisplay,
} from '@/lib/petty-cash-report';

export { storeCodeOf } from '@/lib/petty-cash-report';

export interface CodeGroup<T> {
  code: string;
  display: string;
  brand: string | null;
  rows: T[];
}

export function groupRowsByCode<T extends { code: string; storeNo: string }>(rows: T[]): CodeGroup<T>[] {
  const byCode = new Map<string, T[]>();
  for (const row of rows) {
    const list = byCode.get(row.code);
    if (list) list.push(row);
    else byCode.set(row.code, [row]);
  }

  return [...byCode.entries()]
    .sort(([a], [b]) => compareStoreCodes(a, b))
    .map(([code, list]) => ({
      code,
      display: storeCodeDisplay(code),
      brand: storeCodeBrand(code),
      rows: [...list].sort((a, b) => a.storeNo.localeCompare(b.storeNo, undefined, { numeric: true })),
    }));
}
