// app/api/employee/performance/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth';
import { getEmployeePerformance } from '@/lib/performance/employee-performance';

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(req.url);

    /**
     * Optional:
     * /api/employee/performance?date=2026-05-24
     */
    const dateParam = url.searchParams.get('date');
    const date = dateParam ? new Date(`${dateParam}T00:00:00`) : new Date();

    const data = await getEmployeePerformance({
      userId: session.user.id,
      date,
    });

    return NextResponse.json(data);
  } catch (error) {
    console.error('GET /api/employee/performance failed:', error);

    return NextResponse.json(
      {
        error: 'Failed to load employee performance',
      },
      { status: 500 },
    );
  }
}