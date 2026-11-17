import type { RoomState } from '@lunchrad/shared';

/**
 * When each spin and vote snapshot arrived, on this device's monotonic clock.
 *
 * The server sends relative times (elapsedMs, remainingMs) that are correct at
 * the moment the message arrives. A component may only see the snapshot later:
 * the wheel page opens after the spin started, a phone comes back from the
 * lock screen, Angular renders on the next frame. Timing from "when the
 * component saw it" would make that phone run late; timing from the arrival
 * keeps every phone landing together.
 */
const arrivals = new WeakMap<object, number>();

export function markReceived(state: RoomState, at = performance.now()): void {
  if (state.spin) arrivals.set(state.spin, at);
  if (state.vote) arrivals.set(state.vote, at);
}

/** Arrival time of a spin or vote snapshot; `now` when it was never marked. */
export function receivedAt(snapshot: object, now = performance.now()): number {
  return arrivals.get(snapshot) ?? now;
}
