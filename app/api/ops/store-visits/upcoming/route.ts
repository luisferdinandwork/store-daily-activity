import { NextResponse } from 'next/server';
import { visitActor, visitUpcoming } from '@/lib/store-visit/server';

// GET /api/ops/store-visits/upcoming — the stores that still owe a visit this cycle.
// Ops HO / IT see every area, Ops Area only their own area (resolved server-side).
export async function GET() {
  const guard = await visitActor();
  if (!guard.ok) return guard.response;
  try {
    return NextResponse.json({ success: true, ...(await visitUpcoming(guard.actor)) });
  } catch (error) {
    console.error('Failed to load upcoming store visits', error);
    return NextResponse.json({ success: false, error: 'Upcoming visit gagal dimuat.' }, { status: 500 });
  }
}
