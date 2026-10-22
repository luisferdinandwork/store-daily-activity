import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { stores, storeVisits } from '@/lib/db/schema';
import { visitActor, visitConfiguration, visitHistory, visitStores } from '@/lib/store-visit/server';
import { getStoreGeofence } from '@/lib/db/utils/geofence';
import { evaluateGeofence, geofenceErrorMessage, parseGeoPoint } from '@/lib/geo';
import { uploadToStorage, deleteFromStorage } from '@/lib/storage';
import { sniffImageOf } from '@/lib/upload-validation';
import type { VisitAnswer, VisitPhotoGeo } from '@/lib/store-visit/types';

type Context = { params: Promise<{ storeId: string }> };
const fail = (error: string, status = 400) => NextResponse.json({ success: false, error }, { status });

async function access(ctx: Context) {
  const guard = await visitActor();
  if (!guard.ok) return guard;
  const id = Number((await ctx.params).storeId);
  if (!Number.isInteger(id) || id < 1) return { ok: false as const, response: fail('Toko tidak valid.') };
  const [store] = await db.select({ id: stores.id, areaId: stores.areaId, status: stores.status }).from(stores).where(eq(stores.id, id));
  if (!store) return { ok: false as const, response: fail('Toko tidak ditemukan.', 404) };
  if (!guard.actor.isHO && store.areaId !== guard.actor.areaId) return { ok: false as const, response: fail('Toko berada di luar area Anda.', 403) };
  if (store.status !== 'active') return { ok: false as const, response: fail('Visit hanya tersedia untuk toko aktif.', 409) };
  return { ...guard, store };
}

export async function GET(_req: NextRequest, ctx: Context) {
  const guard = await access(ctx);
  if (!guard.ok) return guard.response;
  try {
    const [list, config, visits] = await Promise.all([
      visitStores(guard.actor.isHO ? null : guard.actor.areaId), visitConfiguration(), visitHistory(guard.store.id, guard.actor),
    ]);
    return NextResponse.json({ success: true, store: list.find((s) => s.id === guard.store.id), tasks: config.tasks, version: config.version, canSubmit: guard.canSubmit, visits });
  } catch (error) {
    console.error('Failed to load store visit', error);
    return fail('Visit gagal dimuat.', 500);
  }
}

export async function POST(req: NextRequest, ctx: Context) {
  const guard = await access(ctx);
  if (!guard.ok) return guard.response;
  if (!guard.canSubmit) return fail('Visit dilakukan oleh Ops Area.', 403);
  if (Number(req.headers.get('content-length')) > 32 * 1024 * 1024) return fail('Total foto maksimal 30 MB.', 413);
  const uploaded: string[] = [];
  let committed = false;
  try {
    const form = await req.formData();
    const raw = form.get('data');
    if (typeof raw !== 'string' || raw.length > 100_000) return fail('Data visit tidak valid.');
    let body;
    try { body = JSON.parse(raw); } catch { return fail('Data visit tidak valid.'); }
    if (!body || typeof body !== 'object') return fail('Data visit tidak valid.');
    if (typeof body.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.id)) return fail('ID visit tidak valid.');
    const [existing] = await db.select({ id: storeVisits.id, storeId: storeVisits.storeId, visitedBy: storeVisits.visitedBy }).from(storeVisits).where(eq(storeVisits.id, body.id));
    if (existing) {
      if (existing.visitedBy !== guard.actor.id || existing.storeId !== guard.store.id) return fail('ID visit sudah digunakan.', 409);
      return NextResponse.json({ success: true, id: existing.id });
    }
    const config = await visitConfiguration();
    if (body.version !== config.version) return fail('Checklist diperbarui IT. Muat ulang halaman untuk menggunakan checklist terbaru.', 409);
    if (typeof body.notes !== 'string' || body.notes.length > 2000) return fail('Catatan maksimal 2.000 karakter.');
    if (!body.answers || typeof body.answers !== 'object' || Array.isArray(body.answers)) return fail('Checklist belum diisi.');
    const fence = await getStoreGeofence(guard.store.id);
    if (!fence) return fail('Koordinat toko belum diatur. Hubungi IT sebelum melakukan visit.', 422);
    const geo = parseGeoPoint(body.geo?.lat, body.geo?.lng, body.geo?.accuracy);
    if (!geo || !geo.accuracy || geo.accuracy > 100) return fail('Lokasi GPS belum akurat (maksimal ±100 m). Coba kembali.', 422);
    const verdict = evaluateGeofence(geo, fence);
    if (!verdict.inside) return fail(geofenceErrorMessage(verdict), 422);
    const now = new Date();
    const fixTime = new Date(body.geo?.capturedAt).getTime();
    if (!Number.isFinite(fixTime) || now.getTime() - fixTime > 120_000 || fixTime > now.getTime() + 30_000) return fail('Lokasi GPS kedaluwarsa. Ambil lokasi kembali.', 422);

    const answers: Record<string, VisitAnswer> = {};
    const photoKeys = ['store'];
    for (const task of config.tasks) {
      const answer = body.answers[task.id];
      if (!answer || !['ya', 'tidak'].includes(answer.answer) || typeof answer.note !== 'string' || answer.note.length > 1000) return fail(`Isi checklist: ${task.label}.`);
      if (answer.answer === 'tidak' && !answer.note.trim()) return fail(`Tuliskan temuan untuk: ${task.label}.`);
      answers[task.id] = { answer: answer.answer, note: answer.note.trim() };
      if (task.requirePhoto) photoKeys.push(`task_${task.id}`);
    }
    // Validate every file and its capture geotag before uploading any object.
    const images: { key: string; buffer: Buffer; mime: string; ext: string; geo: VisitPhotoGeo }[] = [];
    let totalSize = 0;
    for (const key of photoKeys) {
      const file = form.get(key);
      if (!(file instanceof File) || !file.size || file.size > 10 * 1024 * 1024) return fail('Foto toko dan foto task wajib diambil (maksimal 10 MB per foto).');
      totalSize += file.size;
      if (totalSize > 30 * 1024 * 1024) return fail('Total foto maksimal 30 MB.', 413);
      const buffer = Buffer.from(await file.arrayBuffer());
      const format = sniffImageOf(buffer, ['jpg', 'png', 'webp']);
      if (!format) return fail('Foto harus berupa JPEG, PNG, atau WebP.');
      const capture = body.photos?.[key];
      const point = parseGeoPoint(capture?.lat, capture?.lng, capture?.accuracy);
      const capturedAt = typeof capture?.capturedAt === 'string' ? new Date(capture.capturedAt).getTime() : NaN;
      if (!point?.accuracy || point.accuracy > 100 || !Number.isFinite(capturedAt) || now.getTime() - capturedAt > 30 * 60_000 || capturedAt > now.getTime() + 30_000) return fail('Geotag foto tidak valid atau berusia lebih dari 30 menit. Ambil ulang foto.', 422);
      const check = evaluateGeofence(point, fence);
      if (!check.inside) return fail(`Geotag foto: ${geofenceErrorMessage(check)}`, 422);
      images.push({ key, buffer, ...format, geo: { lat: point.lat, lng: point.lng, accuracy: point.accuracy, capturedAt: new Date(capturedAt).toISOString() } });
    }
    const urls: Record<string, string> = {};
    const attempt = crypto.randomUUID();
    for (const image of images) {
      urls[image.key] = await uploadToStorage(image.buffer, `store-visits/${body.id}/${attempt}/${image.key}.${image.ext}`, image.mime);
      uploaded.push(urls[image.key]);
      if (image.key !== 'store') {
        const id = image.key.slice(5);
        answers[id].photoUrl = urls[image.key]; answers[id].photoGeo = image.geo;
      }
    }
    const [created] = await db.insert(storeVisits).values({
      id: body.id, storeId: guard.store.id, visitedBy: guard.actor.id, visitedAt: now,
      photoUrl: urls.store, photoGeo: images[0].geo, lat: String(geo.lat), lng: String(geo.lng),
      accuracy: String(geo.accuracy), distanceM: verdict.distanceM, tasks: config.tasks, answers, notes: body.notes.trim(),
    }).onConflictDoNothing().returning({ id: storeVisits.id });
    committed = !!created;
    if (!created) {
      await deleteFromStorage(uploaded);
      uploaded.length = 0;
      const [saved] = await db.select().from(storeVisits).where(eq(storeVisits.id, body.id));
      if (saved?.visitedBy !== guard.actor.id || saved.storeId !== guard.store.id) return fail('ID visit sudah digunakan.', 409);
    }
    return NextResponse.json({ success: true, id: body.id }, { status: created ? 201 : 200 });
  } catch (error) {
    if (!committed && uploaded.length) {
      try { await deleteFromStorage(uploaded); } catch (cleanupError) { console.error('Failed to clean up store visit photos', cleanupError); }
    }
    console.error('Failed to submit store visit', error);
    return fail('Visit gagal disimpan. Isian tetap tersedia; coba kirim kembali.', 500);
  }
}
