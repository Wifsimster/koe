import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { serve } from '@hono/node-server';
import { widgetRoutes } from './routes/widget';
import { healthRoutes } from './routes/health';
import { fail } from './lib/response';

const app = new Hono();

app.use('*', logger());
app.use(
  '*',
  cors({
    origin: (origin) => origin,
    allowHeaders: ['Content-Type', 'X-Koe-Project-Key', 'Authorization'],
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
  }),
);

app.route('/health', healthRoutes);
app.route('/v1/widget', widgetRoutes);

app.onError((err, c) => {
  console.error('[koe/api] unhandled error', err);
  return fail(c, 'internal_error', 'Unexpected server error', 500);
});

app.notFound((c) => fail(c, 'not_found', 'Route not found', 404));

const port = Number(process.env.PORT ?? 8787);

// Only boot the server when this module is the entry point. Importing
// `app` for tests or serverless adapters won't start listening.
if (import.meta.url === `file://${process.argv[1]}`) {
  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`[koe/api] listening on http://localhost:${info.port}`);
  });
}

export default app;
