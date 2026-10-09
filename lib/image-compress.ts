// lib/image-compress.ts
//
// Client-side: shrinks a photo picked from the gallery / a scanner app before it
// is uploaded. Phone photos are often 4–10 MB; a receipt stays perfectly legible
// at ~2000 px, and one request may carry several photos through a 10 MB proxy.
// (Camera captures are already compressed by useCameraCapture.)
//
// Always resolves: when the browser can't decode the file (e.g. HEIC outside
// Safari) the original comes back untouched and the server decides.

const MAX_EDGE = 2200;
const TARGET_BYTES = 1.5 * 1024 * 1024;
const QUALITIES = [0.88, 0.78, 0.68];

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', quality));
}

export async function compressImageFile(file: File): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));

    // Already small and not oversized: re-encoding would only cost quality.
    if (scale === 1 && file.size <= TARGET_BYTES && /^image\/(jpeg|png|webp)$/.test(file.type)) {
      bitmap.close();
      return file;
    }

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.fillStyle = '#fff'; // PNG transparency would turn black in a JPEG
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();

    let blob: Blob | null = null;
    for (const quality of QUALITIES) {
      blob = await toBlob(canvas, quality);
      if (blob && blob.size <= TARGET_BYTES) break;
    }
    if (!blob || blob.size >= file.size) return file;

    const base = file.name.replace(/\.[^./\\]+$/, '') || 'foto';
    return new File([blob], `${base}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
  } catch {
    return file;
  }
}
