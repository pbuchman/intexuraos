/**
 * PM2 Wait-Start Script
 *
 * Polls a health URL before starting the service entry point.
 * Used by services that depend on app-settings-service at startup.
 *
 * Usage (via ecosystem.config.cjs):
 *   script: TSX_CLI
 *   args: [WAIT_SCRIPT, 'src/index.ts']
 *   env: { WAIT_FOR_SERVICE: 'http://localhost:8122/health' }
 *
 * Runs inside tsx so dynamic import() resolves .ts files correctly.
 */

import { resolve } from 'node:path';

const healthUrl = process.env['WAIT_FOR_SERVICE'];
const maxSeconds = 30;

if (healthUrl) {
  for (let i = 0; i < maxSeconds; i++) {
    try {
      const res = await fetch(healthUrl);
      if (res.ok) break;
    } catch {
      // Service not up yet — retry
    }
    if (i === maxSeconds - 1) {
      console.warn(`Timeout waiting for ${healthUrl} after ${maxSeconds}s, starting anyway`);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

const entryPoint = process.argv[2];
if (!entryPoint) {
  console.error('Usage: pm2-wait-start.mjs <entry-file>');
  process.exit(1);
}

await import(resolve(process.cwd(), entryPoint));
