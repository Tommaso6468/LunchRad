import { Injectable, inject, signal } from '@angular/core';
import { DeviceStore } from './storage';

type Vibrate = (pattern: number | number[]) => boolean;

/**
 * Sound and vibration for the reel. Everything is synthesised with Web Audio
 * (no audio files to load or cache). Browsers only allow sound after the
 * person has touched the page, so the audio context is unlocked on the first
 * tap anywhere. Vibration works on Android; iOS ignores it.
 *
 * One switch ("Geluid") covers both, remembered per device.
 */
@Injectable({ providedIn: 'root' })
export class Feedback {
  private readonly store = inject(DeviceStore);
  readonly enabled = signal(this.store.soundOn());

  private context: AudioContext | null = null;
  private lastTick = 0;

  constructor() {
    if (typeof document === 'undefined') return;
    const unlock = () => {
      this.audio();
      document.removeEventListener('pointerdown', unlock, true);
      document.removeEventListener('keydown', unlock, true);
    };
    document.addEventListener('pointerdown', unlock, true);
    document.addEventListener('keydown', unlock, true);
  }

  toggle(): void {
    const next = !this.enabled();
    this.enabled.set(next);
    this.store.saveSoundOn(next);
    if (next) this.tone(880, 0.06, 0.08);
  }

  /** The lever: a low thunk and a short buzz. */
  lever(): void {
    this.tone(110, 0.12, 0.25, 'triangle');
    this.vibrate(25);
  }

  /** One row passing the window. Limited so a fast reel does not turn into a buzz. */
  tick(): void {
    const now = performance.now();
    if (now - this.lastTick < 45) return;
    this.lastTick = now;
    this.tone(1400, 0.018, 0.05, 'square');
  }

  /** The reel stopped. */
  landed(): void {
    this.tone(659, 0.12, 0.18);
    this.tone(988, 0.25, 0.18, 'sine', 0.1);
    this.vibrate([30, 40, 30]);
  }

  /** Final result: a short rising fanfare. */
  celebrate(): void {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.18, 0.16, 'triangle', i * 0.11));
    this.vibrate([40, 60, 40, 60, 120]);
  }

  private audio(): AudioContext | null {
    if (this.context) {
      if (this.context.state === 'suspended') void this.context.resume().catch(() => undefined);
      return this.context;
    }
    const Ctor = globalThis.AudioContext;
    if (!Ctor) return null;
    try {
      this.context = new Ctor();
    } catch {
      return null;
    }
    return this.context;
  }

  private tone(
    frequency: number,
    seconds: number,
    volume: number,
    type: OscillatorType = 'sine',
    delay = 0,
  ): void {
    if (!this.enabled()) return;
    const ctx = this.audio();
    if (!ctx || ctx.state !== 'running') return;
    const start = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = frequency;
    // Short attack and exponential release: no clicks.
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + seconds);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + seconds + 0.02);
  }

  private vibrate(pattern: number | number[]): void {
    if (!this.enabled()) return;
    const nav = navigator as unknown as { vibrate?: Vibrate };
    try {
      if (typeof nav.vibrate === 'function') nav.vibrate(pattern);
    } catch {
      // Not supported or not allowed: ignore.
    }
  }
}
