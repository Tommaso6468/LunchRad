import { describe, expect, it } from 'vitest';
import { buildReel, randomIndex, shuffle } from '../src/spin.ts';

describe('randomIndex', () => {
  it('stays in range and rejects bad sizes', () => {
    for (let i = 0; i < 1000; i++) {
      const v = randomIndex(7);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(7);
    }
    expect(() => randomIndex(0)).toThrow();
    expect(() => randomIndex(1.5)).toThrow();
  });

  it('rejects values that would cause modulo bias', () => {
    // n = 3: limit is floor(2^32 / 3) * 3 = 4294967295, so 4294967295 is rejected.
    const values = [4294967295, 4];
    const random = (buf: Uint32Array) => {
      buf[0] = values.shift() ?? 0;
    };
    expect(randomIndex(3, random)).toBe(1);
    expect(values).toEqual([]);
  });

  it('is uniform (chi-squared, 60 000 draws over 6 buckets)', () => {
    const counts = new Array<number>(6).fill(0);
    const draws = 60_000;
    for (let i = 0; i < draws; i++) {
      const v = randomIndex(6);
      counts[v] = (counts[v] ?? 0) + 1;
    }
    const expected = draws / 6;
    const chi2 = counts.reduce((sum, c) => sum + (c - expected) ** 2 / expected, 0);
    // 5 degrees of freedom: p = 0.001 at 20.5.
    expect(chi2).toBeLessThan(20.5);
  });
});

describe('shuffle', () => {
  it('keeps every element', () => {
    const items = ['a', 'b', 'c', 'd', 'e'];
    expect(shuffle(items).sort()).toEqual(items);
    expect(items).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});

describe('buildReel', () => {
  it('contains each restaurant once per slice', () => {
    const reel = buildReel([
      { id: 'wok', slices: 3 },
      { id: 'pho', slices: 1 },
      { id: 'bagel', slices: 2 },
    ]);
    expect(reel).toHaveLength(6);
    expect(reel.filter((r) => r === 'wok')).toHaveLength(3);
    expect(reel.filter((r) => r === 'bagel')).toHaveLength(2);
  });

  it('spreads a boosted restaurant’s rows instead of grouping them', () => {
    for (let run = 0; run < 200; run++) {
      const reel = buildReel([
        { id: 'wok', slices: 3 },
        { id: 'a', slices: 1 },
        { id: 'b', slices: 1 },
        { id: 'c', slices: 1 },
        { id: 'd', slices: 1 },
        { id: 'e', slices: 1 },
      ]);
      // On a drum the last row touches the first: check all neighbours, wrapping.
      for (let i = 0; i < reel.length; i++) {
        const next = reel[(i + 1) % reel.length];
        if (reel[i] === 'wok') expect(next, reel.join(',')).not.toBe('wok');
      }
    }
  });

  it('still contains every row when neighbours cannot be avoided', () => {
    const reel = buildReel([
      { id: 'wok', slices: 5 },
      { id: 'pho', slices: 1 },
    ]);
    expect(reel.filter((r) => r === 'wok')).toHaveLength(5);
    expect(reel).toContain('pho');
  });

  it('1 000 simulated spins: each restaurant wins in line with its slices', () => {
    const restaurants = [
      { id: 'wok', slices: 4 },
      { id: 'pho', slices: 1 },
      { id: 'bagel', slices: 2 },
      { id: 'zino', slices: 1 },
    ];
    const total = 8;
    const wins: Record<string, number> = { wok: 0, pho: 0, bagel: 0, zino: 0 };
    const spins = 1000;
    for (let i = 0; i < spins; i++) {
      const reel = buildReel(restaurants);
      const winner = reel[randomIndex(reel.length)] as string;
      wins[winner] = (wins[winner] ?? 0) + 1;
    }
    let chi2 = 0;
    for (const r of restaurants) {
      const expected = (spins * r.slices) / total;
      chi2 += ((wins[r.id] ?? 0) - expected) ** 2 / expected;
    }
    // 3 degrees of freedom: p = 0.001 at 16.27.
    expect(chi2, JSON.stringify(wins)).toBeLessThan(16.27);
  });
});
