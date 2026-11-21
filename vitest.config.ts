import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@clashflight/core': path.resolve(rootDir, 'packages/core/src/index.ts'),
      '@clashflight/ingest': path.resolve(rootDir, 'packages/ingest/src/index.ts'),
      '@clashflight/engine': path.resolve(rootDir, 'packages/engine/src/index.ts'),
      '@clashflight/game': path.resolve(rootDir, 'packages/game/src/index.ts'),
    },
  },
  test: {
    include: ['packages/*/src/**/*.test.ts'],
    environment: 'node',
  },
});
