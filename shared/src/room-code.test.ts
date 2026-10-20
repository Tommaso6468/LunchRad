import { describe, expect, it } from 'vitest';
import {
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  classifyRoomCode,
  generateRoomCode,
  normalizeRoomCode,
} from './room-code.ts';

describe('room code alphabet', () => {
  it('has 32 unique characters, so byte masking is unbiased', () => {
    expect(ROOM_CODE_ALPHABET).toHaveLength(32);
    expect(new Set(ROOM_CODE_ALPHABET).size).toBe(32);
  });

  it('excludes ambiguous characters and symbols', () => {
    for (const char of ['I', 'L', 'O', '1']) {
      expect(ROOM_CODE_ALPHABET).not.toContain(char);
    }
    expect(ROOM_CODE_ALPHABET).toMatch(/^[A-Z0-9]+$/);
  });
});

describe('generateRoomCode', () => {
  it('produces valid codes', () => {
    for (let i = 0; i < 1000; i++) {
      const code = generateRoomCode();
      expect(code).toHaveLength(ROOM_CODE_LENGTH);
      expect(normalizeRoomCode(code)).toBe(code);
    }
  });

  it('uses every character of the alphabet roughly evenly', () => {
    const counts = new Map<string, number>();
    const samples = 4000;
    for (let i = 0; i < samples; i++) {
      for (const char of generateRoomCode()) {
        counts.set(char, (counts.get(char) ?? 0) + 1);
      }
    }
    const expected = (samples * ROOM_CODE_LENGTH) / ROOM_CODE_ALPHABET.length;
    expect(counts.size).toBe(ROOM_CODE_ALPHABET.length);
    for (const count of counts.values()) {
      expect(count).toBeGreaterThan(expected * 0.75);
      expect(count).toBeLessThan(expected * 1.25);
    }
  });
});

describe('normalizeRoomCode', () => {
  it('uppercases, strips spaces and dashes, and maps O to 0', () => {
    expect(normalizeRoomCode(' k7q-4mo ')).toBe('K7Q4M0');
  });

  it('rejects wrong lengths, excluded characters and symbols', () => {
    expect(normalizeRoomCode('K7Q4M')).toBeNull();
    expect(normalizeRoomCode('K7Q4M00')).toBeNull();
    expect(normalizeRoomCode('K7Q4M1')).toBeNull();
    expect(normalizeRoomCode('K7Q4MI')).toBeNull();
    expect(normalizeRoomCode('K7Q4M#')).toBeNull();
    expect(normalizeRoomCode('<scrip')).toBeNull();
  });

  it('rejects oversized input before processing it', () => {
    expect(normalizeRoomCode('A'.repeat(10_000))).toBeNull();
  });
});

describe('classifyRoomCode', () => {
  it('tags letters and digits', () => {
    expect(classifyRoomCode('K7')).toEqual([
      { char: 'K', kind: 'letter' },
      { char: '7', kind: 'digit' },
    ]);
  });
});
