/**
 * The restaurants every new room starts with, until presets can be managed in
 * the admin panel (M5). Each room gets its own copy: removing one in a room
 * never changes this list.
 *
 * Names: at most 40 characters of letters, digits and & ' . , - ( ) / + ! ? : #.
 * Food types: up to 3, in Dutch, at most 30 characters each.
 * Links: Google Maps only. A test checks every entry.
 */
export interface SeedRestaurant {
  name: string;
  categories?: string[];
  mapsUrl?: string;
}

export const SEED_RESTAURANTS: readonly SeedRestaurant[] = [
  {
    name: 'Dikke Mik',
    categories: ['Broodjes'],
    mapsUrl: 'https://maps.app.goo.gl/Gj5mEfNpXg1wFVHZ9',
  },
  {
    name: 'Bibimbap',
    categories: ['Koreaans', 'Broodjes'],
    mapsUrl: 'https://maps.app.goo.gl/ad24L2bzsqnb7e369',
  },
  {
    name: "Zino's",
    categories: ['Italiaans', 'Broodjes'],
    mapsUrl: 'https://maps.app.goo.gl/UyxWz4DRPRZX4rMp7',
  },
  {
    name: 'Tokyo Funa Deli',
    categories: ['Japans'],
    mapsUrl: 'https://maps.app.goo.gl/D9t3Sjd4Tsw4Kb4U8',
  },
  {
    name: "Chang'an DimSum",
    categories: ['Chinees'],
    mapsUrl: 'https://maps.app.goo.gl/5tSkg36UdTrqt32S6',
  },
  {
    name: "Chang'an",
    categories: ['Chinees'],
    mapsUrl: 'https://maps.app.goo.gl/51eGciGzfoDwtveM9',
  },
];
