// app/api/pic/schedule/templates/route.ts
//
// NOTE: Weekly schedule templates have been replaced by monthly schedules.
// This file is kept as a stub that redirects clients to the new monthly API.
// If you still have old UI code referencing /api/pic/schedule/templates,
// update it to use /api/pic/schedule/monthly instead.

import { NextRequest, NextResponse } from 'next/server';

export async function GET(_req: NextRequest) {
  return NextResponse.json(
    {
      success: false,
      error:   'Weekly schedule templates have been replaced by monthly schedules. Use /api/pic/schedule/monthly?yearMonth=YYYY-MM instead.',
      deprecated: true,
    },
    { status: 410 },
  );
}

export async function POST(_req: NextRequest) {
  return NextResponse.json(
    {
      success: false,
      error:   'Weekly schedule templates have been replaced by monthly schedules. Use /api/pic/schedule/import instead.',
      deprecated: true,
    },
    { status: 410 },
  );
}