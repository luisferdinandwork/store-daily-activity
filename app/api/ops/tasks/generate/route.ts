// app/api/ops/tasks/generate/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { generateDailyTasksForDate } from '@/lib/daily-task-utils';

/**
 * POST /api/ops/tasks/generate
 * Body: { storeId: string; date?: string (ISO); createdBy: string }
 *
 * Can be called manually by OPS or automatically by a cron job
 * (e.g., Vercel cron, GitHub Actions, etc.).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { storeId, date, createdBy } = body;

    if (!storeId || !createdBy) {
      return NextResponse.json(
        { success: false, error: 'storeId and createdBy are required' },
        { status: 400 },
      );
    }

    const targetDate = date ? new Date(date) : new Date();

    const result = await generateDailyTasksForDate(storeId, targetDate, createdBy);

    return NextResponse.json(result, { status: result.success ? 200 : 207 });
  } catch (error) {
    console.error('[POST /api/ops/tasks/generate]', error);
    return NextResponse.json(
      { success: false, error: 'Failed to generate tasks' },
      { status: 500 },
    );
  }
}