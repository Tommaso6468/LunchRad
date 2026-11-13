import { describe, expect, it } from 'vitest';
import { normalizeCategories, normalizeMapsUrl, normalizeRestaurantName } from './restaurants';

describe('normalizeRestaurantName', () => {
  it('accepts real-world names', () => {
    for (const name of [
      'Bagels & Beans',
      "'t Hoekje",
      'Café De Zwaan',
      'Pho 99',
      'Burgers & Co.',
      'Wok To Go!',
      'Sushi (Centrum)',
      'Döner/Kapsalon',
    ]) {
      expect(normalizeRestaurantName(name), name).toBe(name);
    }
  });

  it('cleans whitespace and enforces 1–40 characters', () => {
    expect(normalizeRestaurantName('  Wok   To Go ')).toBe('Wok To Go');
    expect(normalizeRestaurantName('a'.repeat(40))).toBe('a'.repeat(40));
    expect(normalizeRestaurantName('a'.repeat(41))).toBeNull();
    expect(normalizeRestaurantName('')).toBeNull();
  });

  it('rejects markup, quotes and control characters', () => {
    for (const bad of ['<b>Wok</b>', 'Wok"', 'Wok`', 'Wok\u0000', 'Wok‮', '{{x}}', '&amp;']) {
      expect(normalizeRestaurantName(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe('normalizeCategories', () => {
  it('is optional', () => {
    expect(normalizeCategories(undefined)).toEqual([]);
    expect(normalizeCategories('  ')).toEqual([]);
    expect(normalizeCategories([])).toEqual([]);
  });

  it('accepts a list or comma-separated text, cleaned and de-duplicated', () => {
    expect(normalizeCategories('Koreaans, Broodjes')).toEqual(['Koreaans', 'Broodjes']);
    expect(normalizeCategories(['Italiaanse  broodjes'])).toEqual(['Italiaanse broodjes']);
    expect(normalizeCategories('Chinees, chinees,, ')).toEqual(['Chinees']);
  });

  it('allows at most 3 food types of 30 characters', () => {
    expect(normalizeCategories('A, B, C')).toEqual(['A', 'B', 'C']);
    expect(normalizeCategories('A, B, C, D')).toBeUndefined();
    expect(normalizeCategories(['a'.repeat(31)])).toBeUndefined();
  });

  it('rejects markup in any entry', () => {
    expect(normalizeCategories(['Chinees', '<script>'])).toBeUndefined();
  });
});

describe('normalizeMapsUrl', () => {
  it('accepts Google Maps links', () => {
    for (const url of [
      'https://www.google.com/maps/place/Wok+To+Go/@52.37,4.89,17z',
      'https://maps.app.goo.gl/AbCdEf123',
      'https://maps.google.com/?q=Wok+To+Go',
      'https://goo.gl/maps/AbCdEf',
      'https://google.com/maps',
    ]) {
      expect(normalizeMapsUrl(url), url).toBe(new URL(url).href);
    }
  });

  it('drops the fragment', () => {
    expect(normalizeMapsUrl('https://maps.app.goo.gl/x#y')).toBe('https://maps.app.goo.gl/x');
  });

  it('rejects everything else', () => {
    for (const url of [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'http://www.google.com/maps',
      'https://www.google.com/search?q=wok',
      'https://www.google.com.evil.example/maps',
      'https://evil.example/maps',
      'https://evil.example/?u=https://www.google.com/maps',
      'https://user:pass@www.google.com/maps',
      'https://www.google.com:8443/maps',
      'https://goo.gl/abc',
      'https://maps.app.goo.gl/',
      'https://constructor/maps',
      `https://maps.app.goo.gl/${'a'.repeat(600)}`,
      'not a url',
    ]) {
      expect(normalizeMapsUrl(url), url).toBeUndefined();
    }
  });

  it('treats empty input as no link', () => {
    expect(normalizeMapsUrl('')).toBeNull();
    expect(normalizeMapsUrl(null)).toBeNull();
  });
});
