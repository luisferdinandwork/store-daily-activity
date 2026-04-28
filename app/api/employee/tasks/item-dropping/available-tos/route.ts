// app/api/employee/tasks/item-dropping/available-tos/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession }          from 'next-auth';
import { authOptions }               from '@/lib/auth';

export interface AvailableTo {
  toNumber:    string;
  description: string | null;
  expectedAt:  string | null;
}

// ─── External API config ──────────────────────────────────────────────────────
// Set TO_API_BASE_URL in your .env to point at the real endpoint.
// Expected shape from external API:
//   GET {TO_API_BASE_URL}/tos?storeId={storeId}&date={YYYY-MM-DD}
//   → { data: Array<{ toNumber: string; description?: string; expectedAt?: string }> }
//
// If TO_API_BASE_URL is not set, the route returns mock data so the UI works
// during development / before the external API is ready.

const TO_API_BASE_URL = process.env.TO_API_BASE_URL ?? '';
const TO_API_KEY      = process.env.TO_API_KEY      ?? '';

function mockTos(storeId: string, date: string): AvailableTo[] {
  // Deterministic mock so the same store+date always returns the same TOs.
  const seed = parseInt(storeId, 10) + new Date(date).getDate();
  const count = (seed % 4) + 1;
  return Array.from({ length: count }, (_, i) => ({
    toNumber:    `TO-${date.replace(/-/g, '')}-${String(storeId).padStart(3, '0')}-${String(i + 1).padStart(3, '0')}`,
    description: `Pengiriman ${['Sepatu', 'Sandal', 'Aksesoris', 'Tas'][i % 4]} batch ${i + 1}`,
    expectedAt:  null,
  }));
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const storeId = searchParams.get('storeId');
  const date    = searchParams.get('date'); // YYYY-MM-DD

  if (!storeId || !date) {
    return NextResponse.json({ success: false, error: 'storeId and date are required' }, { status: 400 });
  }

  // ── Mock fallback ─────────────────────────────────────────────────────────
  if (!TO_API_BASE_URL) {
    return NextResponse.json({ success: true, tos: mockTos(storeId, date) });
  }

  // ── Real external API call ────────────────────────────────────────────────
  try {
    const url = new URL('/tos', TO_API_BASE_URL);
    url.searchParams.set('storeId', storeId);
    url.searchParams.set('date',    date);

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (TO_API_KEY) headers['Authorization'] = `Bearer ${TO_API_KEY}`;

    const res  = await fetch(url.toString(), { headers, next: { revalidate: 60 } });
    if (!res.ok) throw new Error(`External API returned ${res.status}`);

    const payload = await res.json() as { data?: AvailableTo[] };
    const tos: AvailableTo[] = (payload.data ?? []).map(t => ({
      toNumber:    t.toNumber,
      description: t.description ?? null,
      expectedAt:  t.expectedAt  ?? null,
    }));

    return NextResponse.json({ success: true, tos });
  } catch (err) {
    console.error('[GET /api/employee/tasks/item-dropping/available-tos]', err);
    return NextResponse.json(
      { success: false, error: 'Gagal mengambil daftar TO dari server.' },
      { status: 502 },
    );
  }
}