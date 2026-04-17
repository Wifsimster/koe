import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The dashboard is served at `/admin/*` when embedded inside the Koe API
// container. Vite needs `base` so emitted asset URLs resolve under that
// prefix (e.g. `/admin/assets/index-abc.js`). Override with `BASE_URL=/`
// for a standalone deploy at the root.
const base = process.env.BASE_URL ?? '/admin/';

export default defineConfig({
  base,
  plugins: [react()],
  server: {
    port: 5173,
    // Dev-only proxy: when running `pnpm --filter @koe/dashboard dev`
    // with the API on 3000, forward `/v1/*` so fetches don't hit CORS.
    proxy: {
      '/v1': {
        target: process.env.KOE_API_URL ?? 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
