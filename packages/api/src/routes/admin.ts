import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

export function createAdminRoutes(): Hono {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = process.env.DASHBOARD_DIR ?? resolve(here, '../dashboard');
  const indexHtmlPath = resolve(root, 'index.html');

  const admin = new Hono();

  admin.use(
    '/*',
    serveStatic({
      root,
      rewriteRequestPath: (path) => path.replace(/^\/admin/, '') || '/',
    }),
  );

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
