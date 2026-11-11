// app/api/employee/store-closing/hold-categories/route.ts
//
// The On Hold categories an employee can pick on the Store Closing page (active ones,
// in IT's order). Any signed-in user; IT sets them up at /it/store-closing-hold.

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth';
import { listActiveHoldCategories } from '@/lib/db/utils/store-closing-hold';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const categories = await listActiveHoldCategories();
  return NextResponse.json({ success: true, categories });
}
