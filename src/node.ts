import { serve } from '@hono/node-server';
import { existsSync } from 'node:fs';

// Load env variables first before loading app.js (which validates variables)
if (existsSync('.env')) {
  try {
    process.loadEnvFile('.env');
    console.log('✅ Loaded environment variables from .env');
  } catch (err) {
    console.warn('⚠️ Failed to load .env file:', (err as Error).message);
  }
}

import { app } from './app.js';

const port = process.env.PORT ? parseInt(process.env.PORT) : 8000;
const host = '0.0.0.0';

console.log(`🚀 Server starting on http://${host}:${port}`);

serve({
  fetch: app.fetch,
  port,
  hostname: host,
});
