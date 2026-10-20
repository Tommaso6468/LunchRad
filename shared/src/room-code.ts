/**
 * Room codes: 6 characters from a 32-character alphabet.
 *
 * - Letters A–Z without I, L and O (23), digits 0 and 2–9 (9). No symbols:
 *   they force keyboard switching on phones and break share URLs.
 * - O is excluded so a typed 'o' can safely become '0'. I and L are excluded
 *   because they are confused with 1, which is excluded too.
 * - 32^6 ≈ 1.07 billion codes. The alphabet length is a power of two, so
 *   masking a random byte gives a uniform pick without modulo bias.
 */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ023456789';
export const ROOM_CODE_LENGTH = 6;

const ROOM_CODE_PATTERN = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);

/** Generates a room code with the platform CSPRNG. Never use Math.random for this. */
export function generateRoomCode(): string {
  const bytes = new Uint8Array(ROOM_CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let code = '';
  for (const byte of bytes) {
    code += ROOM_CODE_ALPHABET.charAt(byte & 31);
  }
  return code;
}

/**
 * Normalises user input: trims, removes spaces and dashes, uppercases and
 * maps the letter O to the digit 0. Returns null when the result is not a
 * valid room code, so callers never pass unvalidated input on.
 */
export function normalizeRoomCode(input: string): string | null {
  if (input.length > 32) {
    return null;
  }
  const cleaned = input.replace(/[\s-]/g, '').toUpperCase().replace(/O/g, '0');
  return ROOM_CODE_PATTERN.test(cleaned) ? cleaned : null;
}

export type RoomCodeCharKind = 'letter' | 'digit';

/** Splits a valid code into characters tagged as letter or digit, for coloured display. */
export function classifyRoomCode(code: string): { char: string; kind: RoomCodeCharKind }[] {
  return [...code].map((char) => ({ char, kind: /[0-9]/.test(char) ? 'digit' : 'letter' }));
}
