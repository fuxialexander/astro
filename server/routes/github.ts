/**
 * GitHub routes — composed from focused sub-modules.
 * All endpoints remain at /api/github/* with identical behavior.
 *
 * Sub-modules:
 *   github-auth.ts  — OAuth connect/disconnect/callback, status check
 *   github-sync.ts  — Repo sync, project linking/unlinking, issue sync
 *   github-pr.ts    — PR and branch management
 */

import { Hono } from 'hono';
import authApp from './github-auth.js';
import syncApp from './github-sync.js';
import prApp from './github-pr.js';

const app = new Hono();

app.route('/', authApp);
app.route('/', syncApp);
app.route('/', prApp);

export default app;
