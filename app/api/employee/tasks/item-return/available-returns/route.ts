// app/api/employee/tasks/item-return/available-returns/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export interface AvailableReturn {
  returnNumber: string;
  description: string | null;
  expectedAt: string | null;
  quantity: number;
}

// ─── External API config ──────────────────────────────────────────────────────
// Expected shape from BC / external API:
// GET {RETURN_API_BASE_URL}/returns?storeId={storeId}&date={YYYY-MM-DD}
// → {
//   data: Array<{
//     returnNumber: string;
//     description?: string;
//     expectedAt?: string;
//     quantity?: number;
//   }>
// }
//
// If RETURN_API_BASE_URL is not set, this route returns mock data.

const RETURN_API_BASE_URL = process.env.RETURN_API_BASE_URL ?? '';
const RETURN_API_KEY = process.env.RETURN_API_KEY ?? '';

function mockReturns(storeId: string, date: string): AvailableReturn[] {
  const seed = parseInt(storeId, 10) + new Date(date).getDate() + 7;
  const count = seed % 3;

  return Array.from({ length: count }, (_, i) => ({
    returnNumber: `RT-${date.replace(/-/g, '')}-${String(storeId).padStart(3, '0')}-${String(i + 1).padStart(3, '0')}`,
    description: `Return ${['Sepatu', 'Sandal', 'Aksesoris'][i % 3]} batch ${i + 1}`,
    expectedAt: null,
    quantity: ((seed + i) % 10) + 1,
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
  const date = searchParams.get('date');

  if (!storeId || !date) {
    return NextResponse.json(
      { success: false, error: 'storeId and date are required' },
      { status: 400 },
    );
  }

  if (!RETURN_API_BASE_URL) {
    const returns = mockReturns(storeId, date);
    return NextResponse.json({ success: true, hasReturn: returns.length > 0, returns });
  }

  try {
    const url = new URL('/returns', RETURN_API_BASE_URL);
    url.searchParams.set('storeId', storeId);
    url.searchParams.set('date', date);

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (RETURN_API_KEY) headers.Authorization = `Bearer ${RETURN_API_KEY}`;

    const res = await fetch(url.toString(), { headers, next: { revalidate: 60 } });

    if (!res.ok) {
      throw new Error(`External API returned ${res.status}`);
    }

    const payload = (await res.json()) as {
      data?: Array<{
        returnNumber: string;
        description?: string | null;
        expectedAt?: string | null;
        quantity?: number | string | null;
      }>;
    };

    const returns: AvailableReturn[] = (payload.data ?? [])
      .filter((r) => !!r.returnNumber)
      .map((r) => ({
        returnNumber: r.returnNumber,
        description: r.description ?? null,
        expectedAt: r.expectedAt ?? null,
        quantity: normalizeQuantity(r.quantity),
      }));

    return NextResponse.json({ success: true, hasReturn: returns.length > 0, returns });
  } catch (err) {
    console.error('[GET /api/employee/tasks/item-return/available-returns]', err);
    return NextResponse.json(
      { success: false, error: 'Gagal mengambil daftar return dari server.' },
      { status: 502 },
    );
  }
}
