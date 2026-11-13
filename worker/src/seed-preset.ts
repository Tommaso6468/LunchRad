/**
 * The restaurants every new room starts with, until presets can be managed in
 * the admin panel (M5). Each room gets its own copy: removing one in a room
 * never changes this list.
 *
 * Keep names within the restaurant rules (letters, digits, & ' . , - ( ) / + ! ? : #,
 * at most 40 characters); a test checks every entry.
 */
export interface SeedRestaurant {
  name: string;
  category?: string;
  mapsUrl?: string;
}

export const SEED_RESTAURANTS: readonly SeedRestaurant[] = [];
