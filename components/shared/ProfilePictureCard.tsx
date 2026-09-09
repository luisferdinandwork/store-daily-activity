'use client';
// components/shared/ProfilePictureCard.tsx
//
// Self-service "change my profile picture" card. Used by every role's account
// page. Posts to the role-agnostic /api/account/avatar, then refreshes the
// session so session.user.image updates everywhere without a re-login.
//
// A plain file input is used on purpose: a profile picture is cosmetic (not
// task evidence), it must work on cameraless desktops, and on mobile the input
// already offers camera-or-gallery.

import { useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Camera, ImageUp, Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import UserAvatar from './UserAvatar';

const MAX_SIZE_MB = 5;

export default function ProfilePictureCard() {
  const { data: session, update } = useSession();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<null | 'upload' | 'remove'>(null);

  const user = session?.user;
  const currentUrl = user?.image ?? null;

  async function handleFile(file: File) {
    if (!file.type.startsWith('image/')) {
      toast.error('Pilih file gambar.');
      return;
    }
    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      toast.error(`Ukuran file maksimal ${MAX_SIZE_MB}MB.`);
      return;
    }

    setBusy('upload');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/account/avatar', { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? 'Gagal mengunggah foto');

      await update();
      router.refresh();
      toast.success('Foto profil diperbarui');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal mengunggah foto');
    } finally {
      setBusy(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function handleRemove() {
    setBusy('remove');
    try {
      const res = await fetch('/api/account/avatar', { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? 'Gagal menghapus foto');

      await update();
      router.refresh();
      toast.success('Foto profil dihapus');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal menghapus foto');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="max-w-md rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-2.5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <Camera className="h-4 w-4 text-primary" />
        </div>
        <div>
          <p className="text-sm font-bold text-foreground">Foto Profil</p>
          <p className="text-xs text-muted-foreground">JPG, PNG, atau WebP · maksimal {MAX_SIZE_MB}MB</p>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <UserAvatar
          src={currentUrl}
          name={user?.name}
          className="h-16 w-16 border border-border"
          fallbackClassName="text-lg"
        />

        <div className="flex flex-1 flex-wrap gap-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy !== null}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground transition-opacity disabled:opacity-50"
          >
            {busy === 'upload' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageUp className="h-4 w-4" />}
            {currentUrl ? 'Ganti Foto' : 'Unggah Foto'}
          </button>

          {currentUrl && (
            <button
              type="button"
              onClick={handleRemove}
              disabled={busy !== null}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-semibold text-muted-foreground transition-colors hover:border-destructive hover:text-destructive disabled:opacity-50"
            >
              {busy === 'remove' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Hapus
            </button>
          )}
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/heic,image/heif"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
        }}
      />
    </div>
  );
}
