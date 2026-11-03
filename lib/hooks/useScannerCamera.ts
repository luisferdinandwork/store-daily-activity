'use client';
// lib/hooks/useScannerCamera.ts
//
// Rear-camera stream tuned for scanning paper: a higher-resolution request than
// the photo camera, continuous autofocus / exposure / white balance where the
// browser lets us ask for them, tap-to-focus and a torch switch. Used by
// components/shared/DocumentScanner.tsx.
//
// Everything beyond getUserMedia is best-effort — Safari and many Android
// WebViews expose none of the focus/torch constraints, in which case the
// scanner still works on the platform's default autofocus.

import { useCallback, useEffect, useRef, useState } from 'react';

export type ScannerCameraStatus = 'idle' | 'starting' | 'streaming' | 'error';

/** Camera capabilities that lib.dom doesn't type yet. */
interface ExtendedCapabilities {
  focusMode?: string[];
  exposureMode?: string[];
  whiteBalanceMode?: string[];
  pointsOfInterest?: unknown;
  torch?: boolean;
}

/** Long edge of the frame grabbed for the final scan. */
const MAX_FRAME_EDGE = 2560;

export function useScannerCamera() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const capsRef = useRef<ExtendedCapabilities>({});
  const refocusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Bumped by every start() and stop() so an older, still-awaiting start() knows it was superseded. */
  const runId = useRef(0);

  const [status, setStatus] = useState<ScannerCameraStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  const stop = useCallback(() => {
    runId.current++;
    if (refocusTimer.current) clearTimeout(refocusTimer.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    trackRef.current = null;
    setTorchOn(false);
    setStatus('idle');
  }, []);

  const applyAdvanced = useCallback(async (advanced: Record<string, unknown>[]) => {
    const track = trackRef.current;
    if (!track || advanced.length === 0) return;
    try {
      await track.applyConstraints({ advanced } as MediaTrackConstraints);
    } catch {
      /* unsupported on this device — the default autofocus stays in charge */
    }
  }, []);

  const start = useCallback(async () => {
    const id = ++runId.current;
    const superseded = () => id !== runId.current;
    streamRef.current?.getTracks().forEach(t => t.stop());
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
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 2560 },
          height: { ideal: 1440 },
        },
        audio: false,
      });
      if (superseded()) {
        // stop()/another start() came in while the permission prompt was open.
        stream.getTracks().forEach(t => t.stop());
        return;
      }
      streamRef.current = stream;
      const track = stream.getVideoTracks()[0] ?? null;
      trackRef.current = track;

      const caps = ((track?.getCapabilities?.() ?? {}) as unknown) as ExtendedCapabilities;
      capsRef.current = caps;
      setTorchSupported(!!caps.torch);

      // Ask for the modes that matter for reading print; each entry is optional.
      const wanted: Record<string, unknown>[] = [];
      if (caps.focusMode?.includes('continuous')) wanted.push({ focusMode: 'continuous' });
      if (caps.exposureMode?.includes('continuous')) wanted.push({ exposureMode: 'continuous' });
      if (caps.whiteBalanceMode?.includes('continuous')) wanted.push({ whiteBalanceMode: 'continuous' });
      await applyAdvanced(wanted);
      if (superseded()) return;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      if (superseded()) return;
      setStatus('streaming');
    } catch (err) {
      if (superseded()) return; // an interrupted play() of a replaced stream isn't a failure
      const denied = err instanceof DOMException
        && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError');
      setError(
        denied
          ? 'Izin kamera ditolak. Aktifkan akses kamera di pengaturan browser untuk melanjutkan.'
          : 'Tidak dapat mengakses kamera. Pastikan perangkat memiliki kamera yang tersedia.',
      );
      setStatus('error');
    }
  }, [applyAdvanced]);

  const setTorch = useCallback(async (on: boolean) => {
    if (!capsRef.current.torch) return;
    await applyAdvanced([{ torch: on }]);
    setTorchOn(on);
  }, [applyAdvanced]);

  /**
   * Re-run autofocus, optionally aimed at a point (0..1 of the frame). Uses a
   * one-shot focus when the camera supports it, then hands control back to
   * continuous focus.
   */
  const refocus = useCallback(async (point?: { x: number; y: number }) => {
    const caps = capsRef.current;
    const modes = caps.focusMode ?? [];
    if (!modes.includes('single-shot') && !modes.includes('continuous')) return;
    if (refocusTimer.current) clearTimeout(refocusTimer.current);

    if (modes.includes('single-shot')) {
      const shot: Record<string, unknown> = { focusMode: 'single-shot' };
      if (point && caps.pointsOfInterest) shot.pointsOfInterest = [point];
      await applyAdvanced([shot]);
      if (modes.includes('continuous')) {
        refocusTimer.current = setTimeout(() => void applyAdvanced([{ focusMode: 'continuous' }]), 1200);
      }
    } else {
      // Continuous only: toggling nudges the lens to hunt again.
      await applyAdvanced([{ focusMode: 'manual' }]);
      await applyAdvanced([{ focusMode: 'continuous' }]);
    }
  }, [applyAdvanced]);

  /** Snapshot of the current video frame (long edge capped at MAX_FRAME_EDGE). */
  const grabFrame = useCallback((): HTMLCanvasElement | null => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return null;
    const k = Math.min(1, MAX_FRAME_EDGE / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(video.videoWidth * k);
    canvas.height = Math.round(video.videoHeight * k);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas;
  }, []);

  useEffect(() => stop, [stop]);

  return {
    videoRef, status, error, torchSupported, torchOn,
    start, stop, setTorch, refocus, grabFrame,
  };
}
