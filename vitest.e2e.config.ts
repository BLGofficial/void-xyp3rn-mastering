import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['e2e/**/*.e2e.test.ts'],
    // Real decode -> analyze -> 5-pass target render in a browser worker.
    testTimeout: 240_000,
    hookTimeout: 120_000,
  },
});
