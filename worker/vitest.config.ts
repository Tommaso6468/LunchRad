import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// Tests run inside workerd (the real Workers runtime), so HTMLRewriter,
// crypto and Response behave exactly as in production. The ASSETS binding is
// mocked per test, so the Angular build is not needed to run them.
export default defineConfig({
  plugins: [
    cloudflareTest({
      main: './src/index.ts',
      miniflare: {
        compatibilityDate: '2026-10-01',
      },
    }),
  ],
});
