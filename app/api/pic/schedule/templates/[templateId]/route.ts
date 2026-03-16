// app/api/pic/schedule/templates/[templateId]/route.ts
//
// NOTE: Weekly schedule templates have been replaced by monthly schedules.
// Individual day edits now use PATCH /api/pic/schedule/entry/[id].
// Full month deletion uses DELETE /api/pic/schedule/monthly?yearMonth=YYYY-MM.

import { NextRequest, NextResponse } from 'next/server';

const deprecated = NextResponse.json(
  {
    success:    false,
    error:      'Weekly templates are deprecated. Use /api/pic/schedule/entry/[id] to edit a day, or /api/pic/schedule/monthly to manage a month.',
    deprecated: true,
  },
  { status: 410 },
);

export async function PATCH(_req: NextRequest) { return deprecated; }
export async function DELETE(_req: NextRequest) { return deprecated; }