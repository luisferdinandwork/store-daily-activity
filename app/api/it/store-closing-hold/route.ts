// app/api/it/store-closing-hold/route.ts
//
// GET — the Store Closing "On Hold" setup: the default issue template + every category
//       (hidden ones too, with how many closings picked them).
// IT-only. Edits: ./template (default text) and ./categories (+ /[id]).

import { NextResponse } from 'next/server';

import { resolveItScope } from '@/lib/auth/it-scope';
import { getHoldTemplate, listHoldCategoriesAdmin } from '@/lib/db/utils/store-closing-hold';

export async function GET() {
  const scope = await resolveItScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  const [template, categories] = await Promise.all([getHoldTemplate(), listHoldCategoriesAdmin()]);
  return NextResponse.json({ success: true, template, categories });
}
