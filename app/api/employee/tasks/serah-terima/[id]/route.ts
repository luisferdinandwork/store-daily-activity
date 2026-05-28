// app/api/employee/tasks/serah-terima/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { eq } from 'drizzle-orm';

import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { serahTerimaTasks } from '@/lib/db/schema';
import {
  completeSerahTerimaItem,
  getSerahTerimaById,
  submitSerahTerima,
  type GeoPoint,
} from '@/lib/db/utils/serah-terima';

function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function toIso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

function serializeItem(item: {
  id: number;
  taskId: number;
  receiverTaskId: number | null;
  message: string;
  isCompleted: boolean;
  completedBy: string | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: String(item.id),
    taskId: String(item.taskId),
    receiverTaskId: item.receiverTaskId ? String(item.receiverTaskId) : null,
    message: item.message,
    isCompleted: item.isCompleted,
    completedBy: item.completedBy,
    completedAt: toIso(item.completedAt),
    createdAt: toIso(item.createdAt),
    updatedAt: toIso(item.updatedAt),
  };
}

function serializePayload(payload: NonNullable<Awaited<ReturnType<typeof getSerahTerimaById>>>) {
  return {
    task: {
      id: String(payload.task.id),
      scheduleId: String(payload.task.scheduleId),
      userId: payload.task.userId,
      storeId: String(payload.task.storeId),
      shiftId: String(payload.task.shiftId),
      date: toIso(payload.task.date),
      handoverText: payload.task.handoverText ?? '',
      status: payload.task.status,
      notes: payload.task.notes,
      completedAt: toIso(payload.task.completedAt),
      verifiedBy: payload.task.verifiedBy,
      verifiedAt: toIso(payload.task.verifiedAt),
    },
    outgoingItems: payload.outgoingItems.map(serializeItem),
    incomingItems: payload.incomingItems.map(serializeItem),
  };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const { id: rawId } = await params;
  const id = parseId(rawId);

  if (!id) {
    return NextResponse.json({ success: false, error: 'Invalid task id.' }, { status: 400 });
  }

  const payload = await getSerahTerimaById(id);

  if (!payload) {
    return NextResponse.json({ success: false, error: 'Serah terima task not found.' }, { status: 404 });
  }

  return NextResponse.json({ success: true, ...serializePayload(payload) });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const { id: rawId } = await params;
  const id = parseId(rawId);

  if (!id) {
    return NextResponse.json({ success: false, error: 'Invalid task id.' }, { status: 400 });
  }

  const [task] = await db
    .select()
    .from(serahTerimaTasks)
    .where(eq(serahTerimaTasks.id, id))
    .limit(1);

  if (!task) {
    return NextResponse.json({ success: false, error: 'Serah terima task not found.' }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    geo?: GeoPoint;
    handoverText?: string;
    notes?: string;
    skipGeo?: boolean;
  };

  if (!body.geo && !body.skipGeo) {
    return NextResponse.json(
      { success: false, error: 'Lokasi wajib diaktifkan sebelum submit serah terima.' },
      { status: 400 },
    );
  }

  const result = await submitSerahTerima({
    taskId: id,
    scheduleId: task.scheduleId,
    userId: session.user.id,
    storeId: task.storeId,
    shiftId: task.shiftId,
    geo: body.geo ?? { lat: 0, lng: 0 },
    handoverText: body.handoverText ?? '',
    notes: body.notes,
    skipGeo: body.skipGeo,
  });

  if (!result.success) {
    return NextResponse.json({ success: false, error: result.error }, { status: 400 });
  }

  const payload = await getSerahTerimaById(id);

  if (!payload) {
    return NextResponse.json({ success: false, error: 'Serah terima task not found.' }, { status: 404 });
  }

  return NextResponse.json({ success: true, ...serializePayload(payload) });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const { id: rawId } = await params;
  const taskId = parseId(rawId);

  if (!taskId) {
    return NextResponse.json({ success: false, error: 'Invalid task id.' }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    itemId?: string | number;
  };

  const itemId =
    typeof body.itemId === 'number'
      ? body.itemId
      : Number(body.itemId);

  if (!Number.isInteger(itemId) || itemId <= 0) {
    return NextResponse.json({ success: false, error: 'Invalid item id.' }, { status: 400 });
  }

  const result = await completeSerahTerimaItem({
    itemId,
    userId: session.user.id,
  });

  if (!result.success) {
    return NextResponse.json({ success: false, error: result.error }, { status: 400 });
  }

  const payload = await getSerahTerimaById(taskId);

  if (!payload) {
    return NextResponse.json({ success: false, error: 'Serah terima task not found.' }, { status: 404 });
  }

  return NextResponse.json({ success: true, ...serializePayload(payload) });
}
