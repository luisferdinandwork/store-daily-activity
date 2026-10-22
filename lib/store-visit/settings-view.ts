// Pure view logic for the IT "Pengaturan Visit" page (/it/store-visits):
// API types, checklist problems, the per-store rule list's filter + sort.
import { VISIT_CATEGORY_LABELS, type VisitPolicy, type VisitTask } from './types';

export type StoreOption = { id: number; storeNo: string; name: string; status: string };
export type VisitSettings = { config: { tasks: VisitTask[]; version: number }; policies: VisitPolicy[]; stores: StoreOption[] };

export const MAX_TASKS = 30;
export const MAX_TASK_LABEL = 250;
export const INTERVAL_PRESETS = [7, 14, 30, 60, 90];
export const MINIMUM_PRESETS = [1, 2, 3, 4];

export type RuleSource = Pick<VisitPolicy, 'category' | 'intervalDays' | 'minimumVisits'>;

export const ruleKey = (p: Pick<VisitPolicy, 'intervalDays' | 'minimumVisits'>) => `${p.minimumVisits}/${p.intervalDays}`;
export const ruleLabel = (p: Pick<VisitPolicy, 'intervalDays' | 'minimumVisits'>) => `${p.minimumVisits} visit / ${p.intervalDays} hari`;
export const categoryLabel = (c: VisitPolicy['category']) => VISIT_CATEGORY_LABELS[c];

/** The most used rule in a group, e.g. "umumnya 1 visit / 7 hari" — null for an empty group. */
export function commonRule(policies: Pick<VisitPolicy, 'intervalDays' | 'minimumVisits'>[]): string | null {
  const counts = new Map<string, number>();
  for (const p of policies) counts.set(ruleKey(p), (counts.get(ruleKey(p)) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!top) return null;
  const [min, interval] = top[0].split('/');
  return `umumnya ${min} visit / ${interval} hari`;
}

/** Checklist tasks the server would refuse: blank labels, and labels used twice (case-insensitive). */
export function taskProblems(tasks: VisitTask[]) {
  const empty = new Set<string>();
  const duplicate = new Set<string>();
  const seen = new Map<string, string>();
  for (const t of tasks) {
    const key = t.label.trim().toLowerCase();
    if (!key) { empty.add(t.id); continue; }
    const first = seen.get(key);
    if (first) { duplicate.add(first); duplicate.add(t.id); } else seen.set(key, t.id);
  }
  return { empty, duplicate };
}

export type TaskChange = 'new' | 'changed' | null;
export function taskChange(task: VisitTask, saved: VisitTask[]): TaskChange {
  const before = saved.find((s) => s.id === task.id);
  if (!before) return 'new';
  return before.label !== task.label || before.requirePhoto !== task.requirePhoto ? 'changed' : null;
}

export type SortKey = 'name' | 'city' | 'manager' | 'rule';
export const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'name', label: 'Nama toko' },
  { key: 'city', label: 'Kota' },
  { key: 'manager', label: 'Penanggung jawab' },
  { key: 'rule', label: 'Frekuensi' },
];

export interface PolicyFilter {
  query: string;
  category: string; // 'all' | VisitCategory
  rule: string; // 'all' | ruleKey
  registered: string; // 'all' | 'missing'
}

export function filterPolicies(policies: VisitPolicy[], f: PolicyFilter, registeredNos: Set<string>) {
  const q = f.query.trim().toLowerCase();
  return policies.filter((p) =>
    (f.category === 'all' || p.category === f.category)
    && (f.rule === 'all' || ruleKey(p) === f.rule)
    && (f.registered === 'all' || !registeredNos.has(p.storeNo))
    && (!q || `${p.storeNo} ${p.storeName} ${p.manager} ${p.city}`.toLowerCase().includes(q)));
}

export function sortPolicies(policies: VisitPolicy[], key: SortKey, dir: 'asc' | 'desc') {
  const text = (a: string, b: string) => a.localeCompare(b, 'id', { sensitivity: 'base' });
  const sorted = [...policies].sort((a, b) => {
    if (key === 'city') return text(a.city, b.city) || text(a.storeName, b.storeName);
    if (key === 'manager') return text(a.manager, b.manager) || text(a.storeName, b.storeName);
    if (key === 'rule') return a.intervalDays - b.intervalDays || a.minimumVisits - b.minimumVisits || text(a.storeName, b.storeName);
    return text(a.storeName, b.storeName);
  });
  return dir === 'desc' ? sorted.reverse() : sorted;
}

/** The distinct "min / interval" rules in use, most used first, for the rule filter. */
export function ruleOptions(policies: VisitPolicy[]) {
  const counts = new Map<string, { label: string; count: number }>();
  for (const p of policies) {
    const entry = counts.get(ruleKey(p)) ?? { label: ruleLabel(p), count: 0 };
    entry.count += 1;
    counts.set(ruleKey(p), entry);
  }
  return [...counts.entries()].map(([key, v]) => ({ key, ...v })).sort((a, b) => b.count - a.count);
}
