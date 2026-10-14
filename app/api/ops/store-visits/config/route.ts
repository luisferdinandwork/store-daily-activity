import { NextRequest, NextResponse } from 'next/server';
import { eq, and, sql } from 'drizzle-orm';
import { resolveItScope } from '@/lib/auth/it-scope';
import { db } from '@/lib/db';
import { stores, storeVisitConfig, storeVisitPolicies } from '@/lib/db/schema';
import { visitConfiguration } from '@/lib/store-visit/server';
import { validateVisitPolicy, validateVisitTasks } from '@/lib/store-visit/rules';

export async function GET() {
  const scope = await resolveItScope();
  if (!scope.ok) return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  try {
    const [config, policies, storeOptions] = await Promise.all([
      visitConfiguration(),
      db.select().from(storeVisitPolicies).orderBy(storeVisitPolicies.manager, storeVisitPolicies.city, storeVisitPolicies.storeNo),
      db.select({ id: stores.id, name: stores.name, storeNo: stores.storeNo, status: stores.status }).from(stores).orderBy(stores.name),
    ]);
    return NextResponse.json({ success: true, config, policies, stores: storeOptions });
  } catch (error) {
    console.error('Failed to load store visit settings', error);
    return NextResponse.json({ success: false, error: 'Pengaturan visit gagal dimuat.' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const scope = await resolveItScope();
  if (!scope.ok) return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  try {
    const body = await req.json().catch(() => null);
    if (body?.kind === 'tasks') {
      const tasks = validateVisitTasks(body.tasks);
      if (!tasks || !Number.isInteger(body.version)) return NextResponse.json({ success: false, error: 'Isi 1–30 task dengan nama unik dan maksimal 250 karakter.' }, { status: 400 });
      const [updated] = await db.update(storeVisitConfig).set({ tasks, version: sql`${storeVisitConfig.version} + 1`, updatedAt: new Date() })
        .where(and(eq(storeVisitConfig.id, 1), eq(storeVisitConfig.version, body.version))).returning();
      if (!updated) return NextResponse.json({ success: false, error: 'Pengaturan telah diubah. Muat ulang sebelum menyimpan.' }, { status: 409 });
      return NextResponse.json({ success: true, config: updated });
    }
    if (body?.kind === 'policy') {
      const policy = validateVisitPolicy(body.policy);
      if (!policy) return NextResponse.json({ success: false, error: 'Isi kategori, kota, penanggung jawab, interval 1–365 hari, dan jumlah visit 1–interval hari.' }, { status: 400 });
      await db.insert(storeVisitPolicies).values(policy).onConflictDoUpdate({ target: storeVisitPolicies.storeNo, set: { ...policy, updatedAt: new Date() } });
      return NextResponse.json({ success: true });
    }
    return NextResponse.json({ success: false, error: 'Pengaturan tidak valid.' }, { status: 400 });
  } catch (error) {
    console.error('Failed to save store visit settings', error);
    return NextResponse.json({ success: false, error: 'Pengaturan visit gagal disimpan.' }, { status: 500 });
  }
}
