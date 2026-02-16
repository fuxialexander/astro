/**
 * System information endpoints
 *
 * Provides basic system info for browser-side detection
 */

import { Hono } from 'hono';
import os from 'node:os';

const app = new Hono();

/**
 * GET /api/system/hostname
 *
 * Returns the hostname of the machine running the server.
 * Used by the browser to determine if it's on the same machine as a remote agent.
 */
app.get('/hostname', (c) => {
  const hostname = os.hostname();
  return c.json({ hostname });
});

/**
 * GET /api/system/info
 *
 * Returns additional system information (optional, for debugging)
 */
app.get('/info', (c) => {
  return c.json({
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    release: os.release(),
    uptime: os.uptime(),
  });
});

export default app;
