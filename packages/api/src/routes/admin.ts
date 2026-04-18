import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * Mount the Koe dashboard SPA at `/admin/*`.
 *
 * The dashboard is a Vite + TanStack Router SPA built with
 * `base=/admin/`, so asset URLs resolve under `/admin/assets/…`. Any
 * unmatched sub-route (e.g. `/admin/bugs`) falls back to `index.html`
 * so the client-side router can handle it — otherwise a page refresh
 * inside the SPA would return a 404.
 *
 * The route tree is intentionally mounted only when the operator
 * opts in with `ENABLE_DASHBOARD=true`. The static SPA itself is
 * public — auth is enforced by the JSON admin API at `/v1/admin/*`
 * (cookie-signed session via `requireAdmin`), which the SPA calls
 * after the operator logs in.
 */
export function createAdminRoutes(): Hono {
  const here = dirname(fileURLToPath(import.meta.url));
  // In the Docker runtime, this file ships bundled at
  // /app/dist/serve.js and the dashboard static tree is at
  // /app/dashboard. Override with DASHBOARD_DIR if that doesn't match.
  const root = process.env.DASHBOARD_DIR ?? resolve(here, '../dashboard');
  const indexHtmlPath = resolve(root, 'index.html');

  const admin = new Hono();

  // Static assets (JS chunks, CSS, images). Strip the `/admin` prefix
  // so the resolver looks inside `root`, not `root/admin`.
  admin.use(
    '/*',
    serveStatic({
      root,
      rewriteRequestPath: (path) => path.replace(/^\/admin/, '') || '/',
    }),
  );

  // SPA fallback — any GET that didn't match a real file serves
  // index.html so TanStack Router can take over client-side.
  admin.get('/*', async (c) => {
    try {
      const html = await readFile(indexHtmlPath, 'utf-8');
      return c.html(html);
    } catch (err) {
      console.error('[koe/api] failed to read dashboard index.html', err);
      return c.text('Dashboard assets are missing from this image', 500);
    }
  });

  return admin;
}
