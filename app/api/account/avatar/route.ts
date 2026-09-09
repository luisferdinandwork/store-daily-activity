// app/api/account/avatar/route.ts
//
// Self-service profile picture — any authenticated user, any role.
//   POST   multipart/form-data { file }  → uploads + sets users.avatarUrl
//   DELETE                                → clears users.avatarUrl
// The old object is best-effort removed from storage on replace/delete.
// The client should call useSession().update() afterwards so session.user.image
// refreshes without a re-login (see lib/auth.ts jwt `trigger === 'update'`).

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth';
import { setOwnAvatar, clearOwnAvatar } from '@/lib/db/utils/account';
import { uploadToStorage, deleteFromStorage, isStorageUrl } from '@/lib/storage';

const ALLOWED_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
};
const MAX_SIZE_MB = 5;

async function cleanupPrevious(url: string | null) {
  if (url && isStorageUrl(url)) {
    try {
      await deleteFromStorage(url);
    } catch (err) {
      console.warn('[account/avatar] failed to delete previous object', err);
    }
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const userId = (session.user as { id: string }).id;

    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ success: false, error: 'No file provided' }, { status: 400 });
    }
    const ext = ALLOWED_MIME[file.type];
    if (!ext) {
      return NextResponse.json(
        { success: false, error: 'Hanya file gambar (JPEG, PNG, WebP, HEIC).' },
        { status: 415 },
      );
    }
    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      return NextResponse.json(
        { success: false, error: `Ukuran file maksimal ${MAX_SIZE_MB}MB.` },
        { status: 413 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const storagePath = `avatars/${userId}-${Date.now()}.${ext}`;
    const url = await uploadToStorage(buffer, storagePath, file.type);

    const { previousUrl } = await setOwnAvatar(userId, url);
    await cleanupPrevious(previousUrl);

    return NextResponse.json({ success: true, url });
  } catch (err) {
    console.error('[POST /api/account/avatar]', err);
    return NextResponse.json({ success: false, error: 'Gagal mengunggah foto.' }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const userId = (session.user as { id: string }).id;

    const { previousUrl } = await clearOwnAvatar(userId);
    await cleanupPrevious(previousUrl);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[DELETE /api/account/avatar]', err);
    return NextResponse.json({ success: false, error: 'Gagal menghapus foto.' }, { status: 500 });
  }
}
