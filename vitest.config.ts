import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Integration-heavy suites spin multiple app instances + SQLite/electron-native deps.
    // Keep execution deterministic on CI/dev boxes that throttle parallel workers.
    maxWorkers: 1,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      reporter: ['text', 'html'],
      exclude: ['src/client/**']
    }
  }
});
