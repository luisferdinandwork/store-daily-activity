// app/api/employee/tasks/edc-reconciliation/fetch-expected/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { fetchExpectedForTask } from '@/lib/db/utils/edc-reconciliation';

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const result = await fetchExpectedForTask(Number(body.taskId));
  return NextResponse.json(result, { status: result.success ? 200 : 400 });
}
