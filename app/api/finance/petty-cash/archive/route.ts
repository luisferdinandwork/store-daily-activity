// app/api/finance/petty-cash/archive/route.ts

import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json({
    success: true,
    disabled: true,
    message: 'Petty cash image cleanup is disabled. Receipt images are stored permanently.',
  });
}