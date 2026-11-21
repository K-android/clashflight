import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../..');

export default defineConfig({
  resolve: {
    alias: {
      '@clashflight/core': path.resolve(rootDir, 'packages/core/src/index.ts'),
      '@clashflight/ingest': path.resolve(
        rootDir,
        'packages/ingest/src/index.ts'
      ),
      '@clashflight/engine': path.resolve(
        rootDir,
        'packages/engine/src/index.ts'
      ),
      '@clashflight/game': path.resolve(rootDir, 'packages/game/src/index.ts'),
    },
  },
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    exclude: ['web-ifc'],
  },
  server: {
    port: 5173,
    strictPort: false,
  },
});
