/**
 * Restaurant input rules: names, categories ("Chinees", "Italiaanse broodjes")
 * and Google Maps links. Validated on the server for every message; the app
 * runs the same checks first so people get instant feedback.
 */
export const RESTAURANT_NAME_MAX = 40;
export const CATEGORY_MAX = 30;
export const MAPS_URL_MAX = 500;

// Letters, marks and digits plus the punctuation real restaurant names use:
// "Bagels & Beans", "'t Hoekje", "Café De Zwaan", "Pho 99", "Burgers & Co.".
// No markup characters, quotes other than the apostrophe, or controls.
const TEXT_PATTERN = /^[\p{L}\p{M}\p{N}'’][\p{L}\p{M}\p{N} &'’.,\-()/+!?:#]*$/u;

function cleanText(input: string, max: number): string | null {
  if (input.length > max * 4) return null;
  const cleaned = input.normalize('NFC').trim().replace(/\s+/g, ' ');
  const length = [...cleaned].length;
  if (length < 1 || length > max) return null;
  return TEXT_PATTERN.test(cleaned) ? cleaned : null;
}

export function normalizeRestaurantName(input: string): string | null {
  return cleanText(input, RESTAURANT_NAME_MAX);
}

/** Categories are optional: empty input is null, invalid input is undefined. */
export function normalizeCategory(input: string | null | undefined): string | null | undefined {
  if (input === null || input === undefined || input.trim() === '') return null;
  return cleanText(input, CATEGORY_MAX) ?? undefined;
}

/** Key used to keep restaurant names unique per room, case-insensitively. */
export function restaurantKey(name: string): string {
  return name.toLocaleLowerCase('nl');
}

/** Host → does this path count as a Google Maps link? Nothing else is accepted. */
const MAPS_HOSTS: Record<string, (path: string) => boolean> = {
  'www.google.com': (path) => path === '/maps' || path.startsWith('/maps/'),
  'google.com': (path) => path === '/maps' || path.startsWith('/maps/'),
  'maps.google.com': () => true,
  'maps.app.goo.gl': (path) => path.length > 1,
  'goo.gl': (path) => path.startsWith('/maps/'),
};

/**
 * Accepts only Google Maps links, so a link in the list can never point to a
 * phishing page or run script (javascript:, data:). Returns the normalised
 * https URL, null for empty input, or undefined when the link is not allowed.
 */
export function normalizeMapsUrl(input: string | null | undefined): string | null | undefined {
  if (input === null || input === undefined || input.trim() === '') return null;
  const raw = input.trim();
  if (raw.length > MAPS_URL_MAX) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return undefined;
  const pathAllowed = Object.hasOwn(MAPS_HOSTS, url.hostname)
    ? MAPS_HOSTS[url.hostname]?.(url.pathname)
    : false;
  if (!pathAllowed) return undefined;
  url.hash = '';
  return url.href.length <= MAPS_URL_MAX ? url.href : undefined;
}
