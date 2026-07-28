'use client';
// lib/hooks/useCameraCapture.ts
//
// Wraps getUserMedia so the app can capture a photo directly from the device
// camera without ever handing control to the OS file/gallery picker. Used by
// components/shared/CameraCapture.tsx — not meant to be used standalone.

import { useCallback, useEffect, useRef, useState } from 'react';

export type CameraFacingMode = 'environment' | 'user';
export type CameraStatus = 'idle' | 'starting' | 'streaming' | 'error';

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
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: mode } },
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

  const capture = useCallback((): Promise<File | null> => {
    const video = videoRef.current;
    if (!video || status !== 'streaming' || !video.videoWidth) return Promise.resolve(null);

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return Promise.resolve(null);

    // Mirror the preview back for the front camera so the captured photo
    // matches what the user saw on screen, not a flipped selfie.
    if (facingMode === 'user') {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    return new Promise(resolve => {
      canvas.toBlob(blob => {
        if (!blob) { resolve(null); return; }
        resolve(new File([blob], `capture-${Date.now()}.jpg`, { type: 'image/jpeg' }));
      }, 'image/jpeg', 0.9);
    });
  }, [status, facingMode]);

  useEffect(() => stop, [stop]);

  return { videoRef, status, error, facingMode, start, stop, switchCamera, capture };
}
