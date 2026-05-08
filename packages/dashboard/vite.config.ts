import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8'),
) as { version: string };

// Default to `/admin/` because the production deploy embeds the SPA
// under `/admin/` of the API server. The Dockerfile already passes
// `--base=/admin/`, but a local `pnpm --filter @koe/dashboard build`
// without overrides would otherwise emit assets at `/`. Override with
// `BASE_URL=/` for standalone dev or to host at the root.
const baseUrl = process.env.BASE_URL ?? '/admin/';

export default defineConfig({
  base: baseUrl,
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(fileURLToPath(new URL('./src', import.meta.url))),
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString()),
  },
  server: {
    port: 5173,
  },
});
