// lib/scanner/tracker.ts
// Turns the jittery per-frame detections into a steady quad plus a "how long
// has the document held still" clock — the scanner auto-captures off that.

import type { Quad } from './types';
import { maxCornerShift } from './geometry';

/** A detection this far (fraction of the frame) from the tracked quad is a new document. */
const JUMP = 0.12;
/** Corner drift (fraction of the frame) still counted as "holding still". */
const STILL = 0.012;
/** Keep showing the last quad this long after detection drops out. */
const GRACE_MS = 450;
const SMOOTHING = 0.5;

export interface TrackState {
  /** Smoothed quad (0..1 frame fractions) or null when nothing is tracked. */
  quad: Quad | null;
  /** True for a frame in which the detector found nothing but the quad is still shown. */
  held: boolean;
  /** How long the quad has been still, ms. 0 while moving / lost. */
  stableMs: number;
}

export class QuadTracker {
  private smooth: Quad | null = null;
  private anchor: Quad | null = null;
  private stableSince = 0;
  private lastSeen = 0;

  update(detected: Quad | null, now: number): TrackState {
    if (detected) {
      if (!this.smooth || maxCornerShift(detected, this.smooth) > JUMP) {
        this.smooth = detected;
        this.anchor = null;
      } else {
        const s = this.smooth;
        this.smooth = detected.map((p, i) => ({
          x: s[i].x + (p.x - s[i].x) * SMOOTHING,
          y: s[i].y + (p.y - s[i].y) * SMOOTHING,
        })) as Quad;
      }
      this.lastSeen = now;
      if (!this.anchor || maxCornerShift(this.smooth, this.anchor) > STILL) {
        this.anchor = this.smooth;
        this.stableSince = now;
      }
      return { quad: this.smooth, held: false, stableMs: now - this.stableSince };
    }

    if (this.smooth && now - this.lastSeen <= GRACE_MS) {
      this.anchor = null; // a miss breaks the "held still" streak
      return { quad: this.smooth, held: true, stableMs: 0 };
    }
    this.reset();
    return { quad: null, held: false, stableMs: 0 };
  }

  /** Last tracked quad, if any (used to aim the sharpness probe + the shutter burst). */
  get current(): Quad | null {
    return this.smooth;
  }

  reset(): void {
    this.smooth = null;
    this.anchor = null;
    this.stableSince = 0;
    this.lastSeen = 0;
  }
}
