// app/api/it/task-progress/route.ts
//
//   GET /api/it/task-progress?date=D                 → the board: every active store × every task on day D
//   GET /api/it/task-progress?from=A&to=B            → every task, each day A..B (slots done / scheduled)
//   GET /api/it/task-progress?type=T&date=D          → one task, every store's slots on day D
//   GET /api/it/task-progress?type=T&from=A&to=B     → one task, every store, how it did each day A..B
//
// IT only. Read-only: nothing is created for stores nobody has opened.

import { NextRequest, NextResponse } from 'next/server';

import { guardApi } from '@/lib/auth/guards';
import { isDayKey, jakartaTodayKey } from '@/lib/day-bucket';
import { isTaskType } from '@/lib/shift-tasks';
import {
  getOverviewRange,
  getSerahTerimaProgress,
  getTaskBoard,
  getTaskProgressByType,
  getTaskRange,
} from '@/lib/db/utils/task-progress';
import { BOARD_TASK, MAX_RANGE_DAYS } from '@/lib/task-progress';

const bad = (error: string) => NextResponse.json({ success: false, error }, { status: 400 });

export async function GET(req: NextRequest) {
  const guard = await guardApi(['it']);
  if (!guard.ok) return guard.response;

  const sp = req.nextUrl.searchParams;
  const rawType = sp.get('type');
  if (rawType && !isTaskType(rawType)) return bad('Unknown task type.');
  const type = rawType && isTaskType(rawType) ? rawType : null;

  const from = sp.get('from');
  const to = sp.get('to');

  try {
    // ── Ranges ───────────────────────────────────────────────────────────────
    if (from || to) {
      if (!from || !to || !isDayKey(from) || !isDayKey(to) || from > to) return bad('Invalid range.');
      const span = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
      if (span > MAX_RANGE_DAYS) return bad(`Range is limited to ${MAX_RANGE_DAYS} days.`);

      if (type) {
        if (type === BOARD_TASK) return bad('Serah Terima has no history per day.');
        const stores = await getTaskRange(type, from, to);
        return NextResponse.json({ success: true, type, from, to, stores });
      }
      const tasks = await getOverviewRange(from, to);
      return NextResponse.json({ success: true, from, to, tasks });
    }

    // ── One day ──────────────────────────────────────────────────────────────
    const date = sp.get('date') ?? jakartaTodayKey();
    if (!isDayKey(date)) return bad('Invalid date.');

    if (type) {
      const board = type === BOARD_TASK;
      const stores = board ? await getSerahTerimaProgress() : await getTaskProgressByType(date, type);
      return NextResponse.json({ success: true, type, date, board, stores });
    }

    const stores = await getTaskBoard(date);
    return NextResponse.json({ success: true, date, scope: 'all_areas', stores });
  } catch (error) {
    console.error('Failed to load IT task progress', error);
    return NextResponse.json({ success: false, error: 'Failed to load task progress.' }, { status: 500 });
  }
}
