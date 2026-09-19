import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    passWithNoTests: true,
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts'],
    exclude: ['node_modules', 'dist', 'coverage'],
  },
});
