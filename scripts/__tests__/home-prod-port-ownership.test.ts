import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const validator = resolve(process.cwd(), 'scripts/home-prod/validate-port-ownership.mjs');
const processGroups: number[] = [];

afterEach(() => {
  for (const pid of processGroups.splice(0)) {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      /* already exited */
    }
  }
});

async function processTree(): Promise<{ appPid: number; listenerPid: number }> {
  const app = spawn('bash', ['-c', 'sleep 60 & wait'], { detached: true, stdio: 'ignore' });
  if (app.pid === undefined) throw new Error('failed to start process tree fixture');
  processGroups.push(app.pid);
  const childrenPath = `/proc/${app.pid}/task/${app.pid}/children`;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const listenerPid = Number(readFileSync(childrenPath, 'utf8').trim().split(/\s+/u)[0]);
      if (Number.isInteger(listenerPid) && listenerPid > 0) return { appPid: app.pid, listenerPid };
    } catch {
      /* process is still starting */
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
  }
  throw new Error('process tree fixture did not start');
}

describe('Home PROD listener ownership', () => {
  it('accepts a same-uid socket owner descended from a verified PM2 app process', async () => {
    const root = mkdtempSync(join(tmpdir(), 'home-prod-ports-'));
    const { appPid, listenerPid } = await processTree();
    const config = join(root, 'config.json');
    const listeners = join(root, 'listeners.txt');
    const pm2 = join(root, 'pm2.json');
    writeFileSync(config, JSON.stringify({ apps: [{ env: { PORT: '18110' } }] }));
    writeFileSync(pm2, JSON.stringify([{ pid: appPid }]));
    writeFileSync(
      listeners,
      `LISTEN 0 511 127.0.0.1:18110 0.0.0.0:* users:(("node",pid=${listenerPid},fd=3))\n`
    );

    const accepted = spawnSync(
      process.execPath,
      [validator, config, listeners, pm2, String(process.pid)],
      { encoding: 'utf8' }
    );
    expect(accepted.status, accepted.stderr).toBe(0);

    writeFileSync(
      listeners,
      `LISTEN 0 511 127.0.0.1:18110 0.0.0.0:* users:(("foreign",pid=${process.pid},fd=3))\n`
    );
    const rejected = spawnSync(
      process.execPath,
      [validator, config, listeners, pm2, String(process.pid)],
      { encoding: 'utf8' }
    );
    expect(rejected.status).not.toBe(0);
    rmSync(root, { recursive: true });
  });
});
