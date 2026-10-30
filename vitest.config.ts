import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Sample-by-sample renders of oversampled/true-peak chains are CPU-bound.
    testTimeout: 60_000,
  },
});
