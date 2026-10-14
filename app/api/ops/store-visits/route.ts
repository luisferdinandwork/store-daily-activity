import { NextResponse } from 'next/server';
import { visitActor, visitStores } from '@/lib/store-visit/server';

export async function GET() {
  const guard = await visitActor();
  if (!guard.ok) return guard.response;
  try {
    const stores = await visitStores(guard.actor.isHO ? null : guard.actor.areaId);
    return NextResponse.json({ success: true, stores, canSubmit: guard.canSubmit });
  } catch (error) {
    console.error('Failed to load store visits', error);
    return NextResponse.json({ success: false, error: 'Daftar visit gagal dimuat.' }, { status: 500 });
  }
}
