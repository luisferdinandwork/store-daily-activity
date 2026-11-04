import type { VisitAnswer, VisitTask } from './types';

// What Ops Area writes at every store visit: three free-text reports (no Ya / Tidak
// checklist any more — changed 2026-11-04 by request). Client-safe; the form, the API
// and the history all read the same list. A saved visit snapshots these as its `tasks`
// and stores each text as `answers[id] = { answer: 'text', note }`, so visits made with
// the old checklist (Ya / Tidak, IT-edited points) still read back unchanged.

export const VISIT_FIELDS = [
  { id: 'product', label: 'Informasi Product', placeholder: 'Tulis informasi product yang Anda temukan di toko ini…' },
  { id: 'vm', label: 'Informasi VM', placeholder: 'Tulis informasi VM (visual merchandising) yang Anda temukan di toko ini…' },
  { id: 'human', label: 'Human Problem', placeholder: 'Tulis masalah terkait orang / tim toko yang Anda temukan…' },
] as const;

export type VisitFieldId = (typeof VISIT_FIELDS)[number]['id'];
export const VISIT_FIELD_MAX = 3000;

/** The snapshot stored in `store_visits.tasks` for a visit made with these fields. */
export const VISIT_FIELD_TASKS: VisitTask[] = VISIT_FIELDS.map((f) => ({ id: f.id, label: f.label, requirePhoto: false }));

/** Every field filled (after trimming) and within the limit — `null` + a message when not. */
export function validateVisitFields(raw: unknown): { answers: Record<string, VisitAnswer> } | { error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'Isian visit belum diisi.' };
  const input = raw as Record<string, unknown>;
  const answers: Record<string, VisitAnswer> = {};
  for (const field of VISIT_FIELDS) {
    const text = input[field.id];
    if (typeof text !== 'string' || !text.trim()) return { error: `Isi ${field.label}.` };
    if (text.length > VISIT_FIELD_MAX) return { error: `${field.label} maksimal ${VISIT_FIELD_MAX.toLocaleString('id-ID')} karakter.` };
    answers[field.id] = { answer: 'text', note: text.trim() };
  }
  return { answers };
}

/** A visit saved with the text fields (not the old Ya / Tidak checklist). */
export function isTextVisit(visit: { tasks: VisitTask[]; answers: Record<string, VisitAnswer> }): boolean {
  return visit.tasks.some((t) => visit.answers[t.id]?.answer === 'text');
}
