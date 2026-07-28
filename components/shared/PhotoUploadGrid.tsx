'use client';
// components/shared/PhotoUploadGrid.tsx
//
// Reusable "camera-only" photo grid: thumbnails + an add-tile that opens
// CameraCapture (never a file picker) + upload orchestration. This is a
// drop-in replacement for the ~identical local `PhotoUploader` components
// that used to be copy-pasted across the task pages.

import { useState } from 'react';
import { Camera, Check, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import CameraCapture from '@/components/shared/CameraCapture';
import type { CameraFacingMode } from '@/lib/hooks/useCameraCapture';

interface PhotoUploadGridProps {
  label?: string;
  hint?: string;
  photos: string[];
  onChange: (urls: string[]) => void;
  /** Uploads one captured file and resolves to its stored URL. */
  upload: (file: File) => Promise<string>;
  min?: number;
  max: number;
  disabled?: boolean;
  facingMode?: CameraFacingMode;
  tileSize?: 'sm' | 'lg';
  cameraTitle?: string;
}

export default function PhotoUploadGrid({
  label, hint, photos, onChange, upload, min, max, disabled,
  facingMode = 'environment', tileSize = 'sm', cameraTitle,
}: PhotoUploadGridProps) {
  const [uploading, setUploading] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const needed = min ? Math.max(0, min - photos.length) : 0;
  const tileClass = tileSize === 'lg' ? 'h-24 w-24' : 'h-20 w-20';

  async function handleCapture(file: File) {
    setCameraOpen(false);
    if (photos.length >= max) { toast.error(`Maksimal ${max} foto`); return; }
    setUploading(true);
    try {
      const url = await upload(file);
      onChange([...photos, url]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload gagal');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-2">
      {(label || needed > 0 || (min !== undefined && photos.length > 0)) && (
        <div className="flex items-center justify-between">
          {label && <p className="text-xs font-semibold text-foreground">{label}</p>}
          {needed > 0 && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">
              Butuh {needed} lagi
            </span>
          )}
          {min !== undefined && needed === 0 && photos.length > 0 && (
            <span className="flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-bold text-green-700">
              <Check className="h-3 w-3" strokeWidth={3} />Cukup
            </span>
          )}
        </div>
      )}
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}

      <div className="flex flex-wrap gap-2">
        {photos.map((url, i) => (
          <div key={i} className={cn('relative overflow-hidden rounded-xl border border-border', tileClass)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt="" className="h-full w-full object-cover" />
            {!disabled && (
              <button
                type="button"
                onClick={() => onChange(photos.filter((_, j) => j !== i))}
                className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white"
                aria-label={`Hapus foto ${i + 1}`}
              >
                <X className="h-3 w-3" />
              </button>
            )}
            <div className="absolute bottom-0.5 left-0.5 rounded-full bg-black/60 px-1 py-0 text-[9px] font-bold text-white">
              {i + 1}
            </div>
          </div>
        ))}

        {!disabled && photos.length < max && (
          <button
            type="button"
            onClick={() => setCameraOpen(true)}
            disabled={uploading}
            className={cn(
              'flex flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-border bg-secondary text-muted-foreground hover:border-primary/40 hover:text-primary disabled:opacity-50',
              tileClass,
            )}
          >
            {uploading
              ? <Loader2 className="h-5 w-5 animate-spin" />
              : <><Camera className="h-5 w-5" /><span className="text-[9px] font-semibold">Tambah</span></>}
          </button>
        )}
      </div>

      <p className="text-[10px] text-muted-foreground">
        {photos.length}/{max} foto{min ? ` · minimal ${min}` : ''}
      </p>

      <CameraCapture
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCapture={handleCapture}
        facingMode={facingMode}
        title={cameraTitle ?? label}
      />
    </div>
  );
}
