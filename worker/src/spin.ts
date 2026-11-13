/**
 * The spin: which rows are on the reel, in what order, and which one wins.
 *
 * Fairness rests on two things, both tested:
 * - every row is equally likely to win, so a restaurant's chance is exactly
 *   (1 + its boosts) / (all rows);
 * - randomness comes from crypto.getRandomValues, with rejection sampling so
 *   no index is favoured by modulo bias.
 *
 * The order only affects how the reel looks: a restaurant's extra rows are
 * spread evenly around the drum instead of sitting next to each other.
 */

export interface ReelInput {
  id: string;
  /** 1 + number of boosts. */
  slices: number;
}

/** Uniform random integer in [0, n) from the platform CSPRNG, without modulo bias. */
export function randomIndex(n: number, random: (buf: Uint32Array) => void = defaultRandom): number {
  if (!Number.isInteger(n) || n < 1 || n > 2 ** 32) throw new RangeError(`bad n: ${n}`);
  const limit = Math.floor(2 ** 32 / n) * n;
  const buf = new Uint32Array(1);
  for (;;) {
    random(buf);
    const value = buf[0] ?? 0;
    if (value < limit) return value % n;
  }
}

function defaultRandom(buf: Uint32Array): void {
  crypto.getRandomValues(buf);
}

/** Fisher–Yates shuffle with CSPRNG indices. Returns a new array. */
export function shuffle<T>(items: readonly T[], random?: (buf: Uint32Array) => void): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1, random);
    [result[i], result[j]] = [result[j] as T, result[i] as T];
  }
  return result;
}

/**
 * Reel rows: every restaurant `slices` times. Rows are placed one by one,
 * always taking the restaurant that is most "overdue" (its next ideal
 * position on the drum is earliest), but never the same restaurant twice in
 * a row, and the last row never equal to the first (the drum wraps around).
 * That spreads a boosted restaurant evenly and avoids neighbours whenever
 * the numbers allow it. The order is cosmetic: it does not change the odds.
 */
export function buildReel(
  restaurants: readonly ReelInput[],
  random?: (buf: Uint32Array) => void,
): string[] {
  const state = shuffle(restaurants, random).map((r) => ({
    id: r.id,
    left: r.slices,
    step: 1 / r.slices,
    // A random start in [0, step) so equal restaurants do not line up.
    next: (randomIndex(1000, random) / 1000) * (1 / r.slices),
  }));
  const total = state.reduce((sum, r) => sum + r.left, 0);
  const reel: string[] = [];
  for (let i = 0; i < total; i++) {
    const previous = reel.at(-1);
    const first = reel[0];
    const available = state.filter((r) => r.left > 0);
    const ranked = [...available].sort((a, b) => a.next - b.next);
    const pick =
      ranked.find((r) => r.id !== previous && (i < total - 1 || r.id !== first)) ??
      ranked.find((r) => r.id !== previous) ??
      ranked[0];
    if (!pick) break;
    reel.push(pick.id);
    pick.left -= 1;
    pick.next += pick.step;
  }
  return separateNeighbours(reel);
}

/**
 * Repairs any remaining pair of identical neighbours on the circular drum by
 * swapping one of them with a row elsewhere, where the swap creates no new
 * pair. Leaves the reel as it is when that is impossible (one restaurant has
 * more than half of all rows).
 */
function separateNeighbours(reel: string[]): string[] {
  const n = reel.length;
  const at = (i: number) => reel[((i % n) + n) % n];
  const clashes = (i: number, value: string | undefined) =>
    value === at(i - 1) || value === at(i + 1);
  for (let pass = 0; pass < n; pass++) {
    const i = reel.findIndex((value, idx) => n > 1 && value === at(idx + 1));
    if (i < 0) return reel;
    const target = (i + 1) % n;
    const value = reel[target];
    const j = reel.findIndex(
      (other, idx) =>
        other !== value &&
        Math.abs(idx - target) > 1 &&
        !(idx === 0 && target === n - 1) &&
        !(idx === n - 1 && target === 0) &&
        !clashes(idx, value) &&
        !clashes(target, other),
    );
    if (j < 0) return reel;
    [reel[target], reel[j]] = [reel[j] as string, value as string];
  }
  return reel;
}
