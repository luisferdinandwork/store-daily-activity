'use client';
// lib/hooks/useCameraCapture.ts
//
// Wraps getUserMedia so the app can capture a photo directly from the device
// camera without ever handing control to the OS file/gallery picker. Used by
// components/shared/CameraCapture.tsx — not meant to be used standalone.

import { useCallback, useEffect, useRef, useState } from 'react';

export type CameraFacingMode = 'environment' | 'user';
export type CameraStatus = 'idle' | 'starting' | 'streaming' | 'error';

// Long edge cap for a saved photo. Well above what a receipt or any task
// photo needs to stay legible (document-scanner apps typically target
// 1500-2000px on the long edge for small print) — downscaling to this does
// most of the work in staying under MAX_FILE_SIZE_BYTES; the JPEG quality
// step-down in capture() below is just a safety net on top of it.
const MAX_DIMENSION = 1920;
const MAX_FILE_SIZE_BYTES = 1_000_000;
// Never step down further than this — below it, small receipt print starts
// turning to mush before file size buys much more headroom.
const MIN_JPEG_QUALITY = 0.5;

/** Ideal capture resolution matching the device's CURRENT physical
 * orientation (tall when held portrait, wide when held landscape). Most
 * browsers/OSes will then hand back a video stream already rotated to
 * match by the camera stack itself, instead of the sensor's native
 * landscape orientation regardless of how the phone is actually held — the
 * classic cause of a captured photo coming out sideways from what was on
 * screen. This is the standard fix for that class of bug: let the platform
 * do the rotation via a resolution hint, rather than guessing a rotation
 * angle to undo after the fact. */
function idealDimensionsForOrientation(): { width: number; height: number } {
  const portrait = typeof window !== 'undefined' && window.matchMedia('(orientation: portrait)').matches;
  return portrait ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 };
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', quality));
}

export function useCameraCapture() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [status, setStatus] = useState<CameraStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<CameraFacingMode>('environment');

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    setStatus('idle');
  }, []);

  const start = useCallback(async (mode: CameraFacingMode) => {
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    setStatus('starting');
    setError(null);

    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Perangkat ini tidak mendukung akses kamera.');
      setStatus('error');
      return;
    }

    try {
      const { width, height } = idealDimensionsForOrientation();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: mode }, width: { ideal: width }, height: { ideal: height } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setFacingMode(mode);
      setStatus('streaming');
    } catch (err) {
      const denied = err instanceof DOMException
        && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError');
      setError(
        denied
          ? 'Izin kamera ditolak. Aktifkan akses kamera di pengaturan browser untuk melanjutkan.'
          : 'Tidak dapat mengakses kamera. Pastikan perangkat memiliki kamera yang tersedia.',
      );
      setStatus('error');
    }
  }, []);

  const switchCamera = useCallback(() => {
    void start(facingMode === 'environment' ? 'user' : 'environment');
  }, [facingMode, start]);

  // Rotating the phone while the camera is actively open re-requests the
  // stream with resolution hints matching the new orientation — same as a
  // native camera app reflowing when you turn it from portrait to
  // landscape mid-shot, instead of staying locked to whatever orientation
  // was active when the modal first opened.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(orientation: portrait)');
    const handleChange = () => {
      if (streamRef.current) void start(facingMode);
    };
    mq.addEventListener('change', handleChange);
    return () => mq.removeEventListener('change', handleChange);
  }, [facingMode, start]);

  const capture = useCallback((): Promise<File | null> => {
    const video = videoRef.current;
    if (!video || status !== 'streaming' || !video.videoWidth) return Promise.resolve(null);

    const scale = Math.min(1, MAX_DIMENSION / Math.max(video.videoWidth, video.videoHeight));
    const outW = Math.round(video.videoWidth * scale);
    const outH = Math.round(video.videoHeight * scale);

    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return Promise.resolve(null);

    // Save the TRUE camera frame — never mirrored, even for the front camera.
    // The live preview is flipped for a natural "selfie mirror" feel, but the
    // stored photo keeps real orientation so text held up to the front camera
    // (e.g. an ATM card) stays readable for Ops/Finance review. This matches
    // the default phone camera behaviour.
    ctx.drawImage(video, 0, 0, outW, outH);

    return (async () => {
      let quality = 0.85;
      let blob = await canvasToBlob(canvas, quality);
      while (blob && blob.size > MAX_FILE_SIZE_BYTES && quality > MIN_JPEG_QUALITY) {
        quality = Math.max(MIN_JPEG_QUALITY, quality - 0.1);
        blob = await canvasToBlob(canvas, quality);
      }
      if (!blob) return null;
      return new File([blob], `capture-${Date.now()}.jpg`, { type: 'image/jpeg' });
    })();
  }, [status]);

  useEffect(() => stop, [stop]);

  return { videoRef, status, error, facingMode, start, stop, switchCamera, capture };
}
