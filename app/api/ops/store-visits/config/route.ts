import { NextRequest, NextResponse } from 'next/server';
import { eq, and, inArray, sql } from 'drizzle-orm';
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
    if (body?.kind === 'bulk') {
      // Change category / interval / minimum for many stores at once. A field left
      // out stays as it is per store; every merged result must still be a valid rule.
      const storeNos: string[] = Array.isArray(body.storeNos) ? [...new Set<string>(body.storeNos.filter((s: unknown): s is string => typeof s === 'string'))] : [];
      const changes = body.changes && typeof body.changes === 'object' ? body.changes as Record<string, unknown> : {};
      if (!storeNos.length || storeNos.length > 500) return NextResponse.json({ success: false, error: 'Pilih 1–500 toko.' }, { status: 400 });
      if (!['category', 'intervalDays', 'minimumVisits'].some((key) => changes[key] !== undefined && changes[key] !== null)) return NextResponse.json({ success: false, error: 'Pilih minimal satu hal yang diubah.' }, { status: 400 });
      const existing = await db.select().from(storeVisitPolicies).where(inArray(storeVisitPolicies.storeNo, storeNos));
      if (existing.length !== storeNos.length) return NextResponse.json({ success: false, error: 'Sebagian toko tidak ditemukan. Muat ulang halaman.' }, { status: 409 });
      const merged = [];
      for (const row of existing) {
        const policy = validateVisitPolicy({
          ...row,
          category: changes.category ?? row.category,
          intervalDays: changes.intervalDays ?? row.intervalDays,
          minimumVisits: changes.minimumVisits ?? row.minimumVisits,
        });
        if (!policy) return NextResponse.json({ success: false, error: `Aturan tidak valid untuk ${row.storeName} (${row.storeNo}). Minimum visit tidak boleh melebihi jumlah hari interval.` }, { status: 400 });
        merged.push(policy);
      }
      const now = new Date();
      for (let i = 0; i < merged.length; i += 25) {
        await Promise.all(merged.slice(i, i + 25).map((p) => db.update(storeVisitPolicies)
          .set({ category: p.category, intervalDays: p.intervalDays, minimumVisits: p.minimumVisits, updatedAt: now })
          .where(eq(storeVisitPolicies.storeNo, p.storeNo))));
      }
      return NextResponse.json({ success: true, policies: merged });
    }
    return NextResponse.json({ success: false, error: 'Pengaturan tidak valid.' }, { status: 400 });
  } catch (error) {
    console.error('Failed to save store visit settings', error);
    return NextResponse.json({ success: false, error: 'Pengaturan visit gagal disimpan.' }, { status: 500 });
  }
}
