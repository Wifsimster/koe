import { Hono } from 'hono';
import { ok } from '../lib/response';

export const healthRoutes = new Hono();

healthRoutes.get('/', (c) => ok(c, { status: 'ok', service: 'koe-api' }));
