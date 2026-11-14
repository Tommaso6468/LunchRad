import { describe, expect, it } from 'vitest';
import { nameKey, normalizeName } from './names';

describe('normalizeName', () => {
  it('accepts ordinary names and cleans whitespace', () => {
    expect(normalizeName('  Sanne  ')).toBe('Sanne');
    expect(normalizeName('Jan  de   Vries')).toBe('Jan de Vries');
    expect(normalizeName("D'Artagnan")).toBe("D'Artagnan");
    expect(normalizeName('Anne-Fleur')).toBe('Anne-Fleur');
    expect(normalizeName('Zoë')).toBe('Zoë');
    expect(normalizeName('李雷')).toBe('李雷');
  });

  it('normalises to NFC, so composed and decomposed forms match', () => {
    expect(normalizeName('Zoë')).toBe('Zoë');
  });

  it('enforces 1–20 characters, counting code points', () => {
    expect(normalizeName('')).toBeNull();
    expect(normalizeName('   ')).toBeNull();
    expect(normalizeName('a'.repeat(20))).toBe('a'.repeat(20));
    expect(normalizeName('a'.repeat(21))).toBeNull();
  });

  it('rejects lookalike names that mix Latin with Cyrillic or Greek letters', () => {
    expect(normalizeName('\u0422\u043em')).toBeNull(); // Cyrillic Т and о with a Latin m: "Tom"
    expect(normalizeName('S\u0430nne')).toBeNull(); // Cyrillic а
    expect(normalizeName('\u039fla')).toBeNull(); // Greek Ο
    expect(normalizeName('\u0422\u0430\u043d\u044f')).toBe('\u0422\u0430\u043d\u044f'); // Таня
    expect(normalizeName('Sanne 2')).toBe('Sanne 2');
  });

  it('rejects markup, control, zero-width and bidi characters', () => {
    for (const bad of [
      '<script>',
      'Tom"',
      'a&b',
      'Tom\u0000',
      'To​m',
      'Tom‮evil',
      'To\u0007m',
      'To­m',
      '-Tom',
      '😀',
    ]) {
      expect(normalizeName(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it('rejects oversized input before processing it', () => {
    expect(normalizeName('a'.repeat(10_000))).toBeNull();
  });
});

describe('nameKey', () => {
  it('is case-insensitive', () => {
    expect(nameKey('SANNE')).toBe(nameKey('sanne'));
  });
});
