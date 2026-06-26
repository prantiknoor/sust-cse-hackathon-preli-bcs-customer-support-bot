import { serve } from '@hono/node-server';
import { app } from './app.js';

const port = process.env.PORT ? parseInt(process.env.PORT) : 8000;
const host = '0.0.0.0';

console.log(`🚀 Server starting on http://${host}:${port}`);

serve({
  fetch: app.fetch,
  port,
  hostname: host,
});
