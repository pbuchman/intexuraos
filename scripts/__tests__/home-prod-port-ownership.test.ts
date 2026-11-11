import { spawn, spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const validator = resolve(process.cwd(), 'scripts/home-prod/validate-port-ownership.mjs');
const processGroups: number[] = [];
const temporaryRoots: string[] = [];

afterEach(() => {
  for (const pid of processGroups.splice(0)) {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      /* already exited */
    }
  }
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function processTree(): Promise<{ appPid: number; listenerPid: number; port: number }> {
  // The application starts a real socket-owning child and reports its identity over IPC.
  // This avoids Linux-only /proc child discovery and proves a two-generation process tree.
  const listenerSource = `
    const server = require('node:net').createServer();
    server.listen(0, '127.0.0.1', () => process.send({
      listenerPid: process.pid, port: server.address().port
    }));
  `;
  const app = spawn(
    process.execPath,
    [
      '-e',
      `
      const child = require('node:child_process').spawn(process.execPath,
        ['-e', ${JSON.stringify(listenerSource)}], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
      child.on('message', (message) => console.log(JSON.stringify(message)));
    `,
    ],
    { detached: true, stdio: ['ignore', 'pipe', 'pipe'] }
  );
  if (app.pid === undefined) throw new Error('failed to start process tree fixture');
  processGroups.push(app.pid);
  const appPid = app.pid;
  return await new Promise((resolvePromise, reject) => {
    const timeout = setTimeout(() => reject(new Error('process tree fixture did not start')), 5000);
    let output = '';
    app.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    app.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      if (!output.includes('\n')) return;
      clearTimeout(timeout);
      const message = JSON.parse(output.trim()) as { listenerPid: number; port: number };
      resolvePromise({ appPid, ...message });
    });
  });
}

function fixture(appPids: number[], port: number, ownerPid?: number): string[] {
  const root = mkdtempSync(join(tmpdir(), 'home-prod-ports-'));
  temporaryRoots.push(root);
  const config = join(root, 'config.json');
  const listeners = join(root, 'listeners.txt');
  const pm2 = join(root, 'pm2.json');
  writeFileSync(config, JSON.stringify({ apps: [{ env: { PORT: String(port) } }] }));
  writeFileSync(pm2, JSON.stringify(appPids.map((pid) => ({ pid }))));
  const owner = ownerPid === undefined ? '' : ` users:(("node",pid=${ownerPid},fd=3))`;
  writeFileSync(listeners, `LISTEN 0 511 127.0.0.1:${port} 0.0.0.0:*${owner}\n`);
  return [validator, config, listeners, pm2];
}

function validate(args: string[], daemonPid = process.pid): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [...args, String(daemonPid)], { encoding: 'utf8' });
}

describe('Home PROD listener ownership', () => {
  it('accepts a same-uid real socket owner descended from a verified PM2 app process', async () => {
    const { appPid, listenerPid, port } = await processTree();
    const accepted = validate(fixture([appPid], port, listenerPid));
    expect(accepted.status, accepted.stderr).toBe(0);
  });

  it('rejects a real foreign socket owner even under the same daemon and uid', async () => {
    const app = await processTree();
    const foreign = await processTree();
    const rejected = validate(fixture([app.appPid], foreign.port, foreign.listenerPid));
    expect(rejected.status).toBe(1);
    expect(rejected.stderr).toContain('owned outside the dedicated PM2 app tree');
  });

  it('rejects an app outside the dedicated daemon tree', async () => {
    const app = await processTree();
    const foreign = await processTree();
    const rejected = validate(
      fixture([foreign.appPid], foreign.port, foreign.listenerPid),
      app.appPid
    );
    expect(rejected.status).toBe(1);
    expect(rejected.stderr).toContain('outside the dedicated daemon process tree');
  });

  it('rejects a listener with unavailable process identity', async () => {
    const { appPid, port } = await processTree();
    const rejected = validate(fixture([appPid], port, 2147483647));
    expect(rejected.status).toBe(1);
    expect(rejected.stderr).toContain('Process identity is unavailable');
  });

  it('rejects reserved listeners without an owner pid', async () => {
    const { appPid, port } = await processTree();
    const rejected = validate(fixture([appPid], port));
    expect(rejected.status).toBe(1);
    expect(rejected.stderr).toContain('owned outside the dedicated PM2 app tree');
  });

  it('rejects a daemon whose uid differs from the caller', async () => {
    const { appPid, listenerPid, port } = await processTree();
    // Non-root hosts use the existing root-owned init process; root can run
    // the validator under a different uid without modifying the daemon fixture.
    const rootCaller = process.getuid?.() === 0;
    const args = fixture([appPid], port, listenerPid);
    const rejected = spawnSync(process.execPath, [...args, String(rootCaller ? process.pid : 1)], {
      encoding: 'utf8',
      ...(rootCaller ? { uid: 65534, gid: 65534 } : {}),
    });
    expect(rejected.status).toBe(1);
    expect(rejected.stderr).toContain('Dedicated PM2 daemon runs under an unexpected uid');
  });
});
