/**
 * Participant names: what people type when joining a room.
 *
 * Allowed: letters (any script), combining marks, digits, spaces, and the
 * separators ' - . Everything else is rejected, including control characters,
 * zero-width and bidirectional-override characters (used to spoof names), and
 * HTML/markup characters. The app renders names as text only, so this is
 * defence in depth, not the XSS control itself.
 *
 * Names that mix Latin with Cyrillic or Greek letters are refused too: "Тоm"
 * with a Cyrillic Т and о looks exactly like "Tom" (homoglyph impersonation).
 * A name in one script only, like "Таня" or "Sanne", is fine.
 */
export const NAME_MAX_LENGTH = 20;

const NAME_PATTERN = /^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N} '.-]*$/u;

/** Returns the cleaned name, or null when it is not acceptable. */
export function normalizeName(input: string): string | null {
  if (input.length > 100) {
    return null;
  }
  const cleaned = input.normalize('NFC').trim().replace(/\s+/g, ' ');
  const length = [...cleaned].length;
  if (length < 1 || length > NAME_MAX_LENGTH) {
    return null;
  }
  if (!NAME_PATTERN.test(cleaned)) return null;
  const scripts = [/\p{Script=Latin}/u, /\p{Script=Cyrillic}/u, /\p{Script=Greek}/u].filter((re) =>
    re.test(cleaned),
  );
  return scripts.length > 1 ? null : cleaned;
}

/** Key used to enforce unique names per room, case-insensitively. */
export function nameKey(name: string): string {
  return name.toLocaleLowerCase('nl');
}
