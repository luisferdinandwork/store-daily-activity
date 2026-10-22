import { addDaysKey, jakartaTodayKey } from '@/lib/day-bucket';
import { cycleContaining, distinctVisitDays } from './cycles';
import type { VisitPolicy, VisitTask } from './types';

// Where a store stands in its CURRENT visit cycle (see cycles.ts: back-to-back
// cycles, e.g. Monday–Sunday for 7 days). Counts distinct WIB visit days, so
// repeated submissions on one day cannot meet a multi-visit obligation. Only
// completed, geofence-validated visits are fed in.
// dueDate: the cycle's last day while visits are still owed, otherwise the day
// the next cycle starts.
export function visitProgress(policy: VisitPolicy | null, visitDates: (Date | string)[], today = jakartaTodayKey()) {
  const days = distinctVisitDays(visitDates, today);
  if (!policy) return { completed: 0, remaining: 0, dueDate: null, lastVisit: days[0] ?? null };
  const cycle = cycleContaining(today, policy.intervalDays);
  const completed = days.filter((d) => d >= cycle.start && d <= cycle.end).length;
  const remaining = Math.max(0, policy.minimumVisits - completed);
  return {
    completed,
    remaining,
    dueDate: remaining > 0 ? cycle.end : addDaysKey(cycle.end, 1),
    lastVisit: days[0] ?? null,
  };
}

export function validateVisitPolicy(raw: unknown): VisitPolicy | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  if (typeof p.storeNo !== 'string' || !/^[A-Z0-9-]{2,30}$/.test(p.storeNo)) return null;
  if (p.category !== 'in_city' && p.category !== 'out_city') return null;
  if (typeof p.intervalDays !== 'number' || !Number.isInteger(p.intervalDays) || p.intervalDays < 1 || p.intervalDays > 365) return null;
  if (typeof p.minimumVisits !== 'number' || !Number.isInteger(p.minimumVisits) || p.minimumVisits < 1 || p.minimumVisits > p.intervalDays) return null;
  if (!['storeName', 'manager', 'city'].every((key) => typeof p[key] === 'string' && (p[key] as string).trim().length > 0 && (p[key] as string).length <= 200)) return null;
  return { storeNo: p.storeNo, storeName: (p.storeName as string).trim(), manager: (p.manager as string).trim(), city: (p.city as string).trim(), category: p.category, intervalDays: p.intervalDays, minimumVisits: p.minimumVisits };
}

export function validateVisitTasks(raw: unknown): VisitTask[] | null {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 30) return null;
  const ids = new Set<string>();
  const labels = new Set<string>();
  const tasks: VisitTask[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') return null;
    if (typeof item.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(item.id) || ids.has(item.id) || ['__proto__', 'constructor', 'prototype'].includes(item.id)) return null;
    if (typeof item.label !== 'string' || !item.label.trim() || item.label.length > 250 || typeof item.requirePhoto !== 'boolean') return null;
    const label = item.label.trim().toLowerCase();
    if (labels.has(label)) return null;
    labels.add(label);
    ids.add(item.id);
    tasks.push({ id: item.id, label: item.label.trim(), requirePhoto: item.requirePhoto });
  }
  return tasks;
}

