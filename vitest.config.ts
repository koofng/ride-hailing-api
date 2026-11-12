import { defineConfig } from 'vitest/config';

// Unit tests: no database or network needed.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['src/**/*.spec.ts'],
  },
});
