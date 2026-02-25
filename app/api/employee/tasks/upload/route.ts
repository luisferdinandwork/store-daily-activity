// app/api/employee/tasks/upload/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

// Lazy-load Vercel Blob only in production
let blobPut: ((path: string, file: File, opts: { access: 'public' }) => Promise<{ url: string }>) | null = null;
if (process.env.VERCEL_ENV) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const blob = require('@vercel/blob');
    blobPut = blob.put;
  } catch {
    console.warn('[@vercel/blob] not available — falling back to local storage');
  }
}

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const MAX_SIZE_MB = 10;

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // Validate mime type
    if (!ALLOWED_MIME.includes(file.type)) {
      return NextResponse.json(
        { error: 'Only image files are allowed (JPEG, PNG, WebP, HEIC)' },
        { status: 400 },
      );
    }

    // Validate size
    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      return NextResponse.json(
        { error: `File size must be under ${MAX_SIZE_MB}MB` },
        { status: 400 },
      );
    }

    const timestamp = Date.now();
    const ext = file.name.split('.').pop() ?? 'jpg';
    const safeName = `${session.user.id}-${timestamp}.${ext}`;

    let url: string;

    if (blobPut && process.env.VERCEL_ENV) {
      // Vercel Blob (production)
      const blob = await blobPut(`tasks/${safeName}`, file, { access: 'public' });
      url = blob.url;
    } else {
      // Local filesystem (development)
      const bytes = await file.arrayBuffer();
      const buffer = Buffer.from(bytes);

      const uploadDir = join(process.cwd(), 'public', 'uploads', 'tasks');
      if (!existsSync(uploadDir)) {
        await mkdir(uploadDir, { recursive: true });
      }

      await writeFile(join(uploadDir, safeName), buffer);
      url = `/uploads/tasks/${safeName}`;
    }

    return NextResponse.json({ url });
  } catch (error) {
    console.error('[POST /api/employee/tasks/upload]', error);
    return NextResponse.json({ error: 'Failed to upload file' }, { status: 500 });
  }
}