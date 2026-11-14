import { describe, expect, it } from 'vitest';
import { acceptableTeamKey, normalizeTeamKey } from './admin';

describe('team keys', () => {
  it('normalizes case and spaces', () => {
    expect(normalizeTeamKey('  Kroket  Fiets\tWolk ')).toBe('kroket fiets wolk');
  });

  it('accepts phrases and long mixed keys', () => {
    expect(acceptableTeamKey('kroket fiets wolk')).toBe('kroket fiets wolk');
    expect(acceptableTeamKey('Lunch-2026-team!')).toBe('lunch-2026-team!');
  });

  it('refuses short, repetitive, digit-only, too long and control-character keys', () => {
    for (const weak of [
      'kort',
      'elf tekens!',
      'aaaaaaaaaaaaaaaa',
      'ababababababab',
      '123412341234',
      '1234 5678 9012',
      'x'.repeat(65),
      'kroket\u0000fiets wolk',
    ]) {
      expect(acceptableTeamKey(weak), weak).toBeNull();
    }
  });
});
