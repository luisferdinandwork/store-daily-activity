// app/api/employee/tasks/item-dropping/available-tos/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession }          from 'next-auth';
import { authOptions }               from '@/lib/auth';

export interface AvailableTo {
  toNumber:    string;
  description: string | null;
  expectedAt:  string | null;
  quantity:    number;
}

// ─── External API config ──────────────────────────────────────────────────────
// Expected shape from external API:
// GET {TO_API_BASE_URL}/tos?storeId={storeId}&date={YYYY-MM-DD}
// → {
//   data: Array<{
//     toNumber: string;
//     description?: string;
//     expectedAt?: string;
//     quantity?: number;
//   }>
// }
//
// If TO_API_BASE_URL is not set, this route returns mock data.

const TO_API_BASE_URL = process.env.TO_API_BASE_URL ?? '';
const TO_API_KEY      = process.env.TO_API_KEY      ?? '';

function mockTos(storeId: string, date: string): AvailableTo[] {
  const seed = parseInt(storeId, 10) + new Date(date).getDate();
  const count = (seed % 4) + 1;

  return Array.from({ length: count }, (_, i) => ({
    toNumber:    `TO-${date.replace(/-/g, '')}-${String(storeId).padStart(3, '0')}-${String(i + 1).padStart(3, '0')}`,
    description: `Pengiriman ${['Sepatu', 'Sandal', 'Aksesoris', 'Tas'][i % 4]} batch ${i + 1}`,
    expectedAt:  null,
    quantity:    ((seed + i) % 15) + 1,
  }));
}

function normalizeQuantity(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const storeId = searchParams.get('storeId');
  const date    = searchParams.get('date');

  if (!storeId || !date) {
    return NextResponse.json(
      { success: false, error: 'storeId and date are required' },
      { status: 400 },
    );
  }

  // Mock fallback
  if (!TO_API_BASE_URL) {
    const tos = mockTos(storeId, date);

    return NextResponse.json({
      success: true,
      hasDropping: tos.length > 0,
      tos,
    });
  }

  try {
    const url = new URL('/tos', TO_API_BASE_URL);
    url.searchParams.set('storeId', storeId);
    url.searchParams.set('date', date);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (TO_API_KEY) {
      headers.Authorization = `Bearer ${TO_API_KEY}`;
    }

    const res = await fetch(url.toString(), {
      headers,
      next: { revalidate: 60 },
    });

    if (!res.ok) {
      throw new Error(`External API returned ${res.status}`);
    }

    const payload = await res.json() as {
      data?: Array<{
        toNumber: string;
        description?: string | null;
        expectedAt?: string | null;
        quantity?: number | string | null;
      }>;
    };

    const tos: AvailableTo[] = (payload.data ?? [])
      .filter(t => !!t.toNumber)
      .map(t => ({
        toNumber:    t.toNumber,
        description: t.description ?? null,
        expectedAt:  t.expectedAt ?? null,
        quantity:    normalizeQuantity(t.quantity),
      }));

    return NextResponse.json({
      success: true,
      hasDropping: tos.length > 0,
      tos,
    });
  } catch (err) {
    console.error('[GET /api/employee/tasks/item-dropping/available-tos]', err);

    return NextResponse.json(
      { success: false, error: 'Gagal mengambil daftar TO dari server.' },
      { status: 502 },
    );
  }
}