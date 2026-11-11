import { describe, expect, it } from 'vitest';
import { BASELINE_HEADERS } from '../src/security.ts';
// Imported as raw text at build time: the Workers runtime has no file system.
import headersFile from '../../app/public/_headers?raw';

describe('app/public/_headers', () => {
  it('applies the same baseline headers to static assets as the Worker', () => {
    for (const [name, value] of Object.entries(BASELINE_HEADERS)) {
      expect(headersFile, name).toContain(`${name}: ${value}`);
    }
  });
});
