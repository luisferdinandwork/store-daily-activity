// app/api/pic/schedule/templates/[templateId]/route.ts
//
// NOTE: Weekly schedule templates have been replaced by monthly schedules.
// Individual day edits now use PATCH /api/pic/schedule/entry/[id].
// Full month deletion uses DELETE /api/pic/schedule/monthly?yearMonth=YYYY-MM.

import { NextRequest, NextResponse } from 'next/server';

// A fresh Response per request. This used to be a single module-level NextResponse
// returned by every call — a Response body can only be consumed once, so the second
// request to this route would have failed with "Body is unusable".
function deprecated() {
  return NextResponse.json(
    {
      success:    false,
      error:      'Weekly templates are deprecated. Use /api/pic/schedule/entry/[id] to edit a day, or /api/pic/schedule/monthly to manage a month.',
      deprecated: true,
    },
    { status: 410 },
  );
}

export async function PATCH(_req: NextRequest) { return deprecated(); }
export async function DELETE(_req: NextRequest) { return deprecated(); }
