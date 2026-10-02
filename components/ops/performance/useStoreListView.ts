'use client';
// components/ops/performance/useStoreListView.ts
//
// Everything the Performance Targets store list needs between "the API gave us
// stores" and "rows on screen": search, area / health filters, sort, area
// grouping, chip counts and the network summary. Lives in a hook (owned by the
// page) so the detail view can step through the very same filtered + sorted
// list with its previous / next buttons.

import { useCallback, useMemo, useState } from 'react';

import {
  assessStore,
  compareStores,
  defaultSortDir,
  HEALTH_FILTERS,
  matchesHealthFilter,
  matchesSearch,
  monthPhase,
  summarize,
  type AssessedStore,
  type HealthFilter,
  type MonthPhase,
  type NetworkSummary,
  type SortDir,
  type SortKey,
  type StoreRow,
} from '@/lib/performance/target-view';

const NO_AREA = 'Tanpa Area';
const collator = new Intl.Collator('id', { sensitivity: 'base', numeric: true });

export type AreaGroup = { name: string; items: AssessedStore[]; summary: NetworkSummary };

export type StoreListView = {
  phase: MonthPhase;

  search: string;
  setSearch: (value: string) => void;
  areaFilter: string; // 'all' | areaId
  setAreaFilter: (value: string) => void;
  healthFilter: HealthFilter;
  setHealthFilter: (value: HealthFilter) => void;
  sortKey: SortKey;
  sortDir: SortDir;
  setSort: (next: { key: SortKey; dir: SortDir; keyChanged: boolean }) => void;
  /** Column-header click: same key flips the direction, a new key starts at its default. */
  toggleSortBy: (key: SortKey) => void;
  showClosed: boolean;
  setShowClosed: (value: boolean) => void;
  groupByArea: boolean;
  setGroupByArea: (value: boolean) => void;
  filtersActive: boolean;
  clearFilters: () => void;

  areas: { id: string; name: string }[];
  /** Stores that match search / area / closed — the base the chips and summary count. */
  scoped: AssessedStore[];
  /** `scoped` narrowed by the health chip and sorted — the rows shown. */
  visible: AssessedStore[];
  groups: AreaGroup[];
  /** The rows in the order they appear on screen (area by area when grouped) — what ‹ › steps through. */
  ordered: AssessedStore[];
  chips: { key: HealthFilter; label: string; count: number; tone: 'emerald' | 'amber' | 'rose' | 'indigo' | 'slate' | null }[];
  summary: NetworkSummary;
  closedCount: number;
  totalCount: number;
};

export function useStoreListView(stores: StoreRow[], yearMonth: string): StoreListView {
  const [search, setSearch] = useState('');
  const [areaFilter, setAreaFilter] = useState('all');
  const [healthFilter, setHealthFilter] = useState<HealthFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [showClosed, setShowClosed] = useState(false);
  // null = automatic: grouped whenever the list spans more than one area.
  const [groupPref, setGroupPref] = useState<boolean | null>(null);

  const phase = useMemo(() => monthPhase(yearMonth), [yearMonth]);

  const assessed = useMemo<AssessedStore[]>(
    () => stores.map((row) => ({ row, a: assessStore(row, phase) })),
    [stores, phase],
  );

  const areas = useMemo(() => {
    const byId = new Map<string, string>();
    for (const { row } of assessed) {
      if (row.areaId != null) byId.set(String(row.areaId), row.areaName ?? NO_AREA);
    }
    return [...byId].map(([id, name]) => ({ id, name })).sort((a, b) => collator.compare(a.name, b.name));
  }, [assessed]);

  const closedCount = useMemo(
    () => assessed.filter(({ row }) => row.status === 'close').length,
    [assessed],
  );

  const scoped = useMemo(
    () =>
      assessed.filter(({ row }) => {
        if (!showClosed && row.status === 'close') return false;
        if (areaFilter !== 'all' && String(row.areaId) !== areaFilter) return false;
        return matchesSearch(row, search);
      }),
    [assessed, showClosed, areaFilter, search],
  );

  const visible = useMemo(
    () =>
      scoped
        .filter(({ a }) => matchesHealthFilter(a, healthFilter))
        .sort((x, y) => compareStores(x, y, sortKey, sortDir)),
    [scoped, healthFilter, sortKey, sortDir],
  );

  const groupByArea = groupPref ?? areas.length > 1;

  const groups = useMemo<AreaGroup[]>(() => {
    if (!groupByArea) return [];
    const byArea = new Map<string, AssessedStore[]>();
    for (const item of visible) {
      const name = item.row.areaName?.trim() || NO_AREA;
      const list = byArea.get(name);
      if (list) list.push(item);
      else byArea.set(name, [item]);
    }
    return [...byArea]
      .map(([name, items]) => ({ name, items, summary: summarize(items) }))
      .sort((a, b) => {
        if (a.name === NO_AREA) return 1;
        if (b.name === NO_AREA) return -1;
        return collator.compare(a.name, b.name);
      });
  }, [groupByArea, visible]);

  const ordered = useMemo(
    () => (groupByArea ? groups.flatMap((g) => g.items) : visible),
    [groupByArea, groups, visible],
  );

  const summary = useMemo(() => summarize(scoped), [scoped]);

  const chips = useMemo(() => {
    const counts = new Map<HealthFilter, number>();
    for (const f of HEALTH_FILTERS) {
      counts.set(f.key, scoped.filter(({ a }) => matchesHealthFilter(a, f.key)).length);
    }
    // Only offer a bucket that has stores (and always the active one, so it can be undone).
    return HEALTH_FILTERS
      .filter((f) => f.key === 'all' || f.key === healthFilter || (counts.get(f.key) ?? 0) > 0)
      .map((f) => ({ key: f.key, label: f.label, tone: f.tone, count: counts.get(f.key) ?? 0 }));
  }, [scoped, healthFilter]);

  const setSort = useCallback((next: { key: SortKey; dir: SortDir; keyChanged: boolean }) => {
    setSortKey(next.key);
    setSortDir(next.keyChanged ? defaultSortDir(next.key) : next.dir);
  }, []);

  const toggleSortBy = useCallback(
    (key: SortKey) => {
      if (key === sortKey) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortKey(key);
        setSortDir(defaultSortDir(key));
      }
    },
    [sortKey],
  );

  const filtersActive = search.trim() !== '' || areaFilter !== 'all' || healthFilter !== 'all';

  const clearFilters = useCallback(() => {
    setSearch('');
    setAreaFilter('all');
    setHealthFilter('all');
  }, []);

  return {
    phase,
    search,
    setSearch,
    areaFilter,
    setAreaFilter,
    healthFilter,
    setHealthFilter,
    sortKey,
    sortDir,
    setSort,
    toggleSortBy,
    showClosed,
    setShowClosed,
    groupByArea,
    setGroupByArea: setGroupPref,
    filtersActive,
    clearFilters,
    areas,
    scoped,
    visible,
    groups,
    ordered,
    chips,
    summary,
    closedCount,
    totalCount: assessed.length,
  };
}
