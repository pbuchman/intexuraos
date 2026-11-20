import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import type { BootstrapEnvConfig } from '../../bootstrap/env-config.js';
import { configureTaskAccess } from '../../bootstrap/task-access.js';

it('pins the public key, audience and legacy lookup to operator configuration', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'task-public-key-'));
  const file = join(dir, 'public.pem');
  const base = {
    codeAgentUrl: 'https://app.example',
    internalAuthToken: 'fixture',
  } as BootstrapEnvConfig;
  const configured = {
    ...base,
    taskAccessPublicKeyPath: file,
    taskAccessAudience: 'https://worker.example/test/',
  };
  try {
    expect(configureTaskAccess(base, dir)).toBeUndefined();
    expect(() => configureTaskAccess({ ...base, taskAccessPublicKeyPath: file }, dir)).toThrow(
      'both'
    );
    expect(() =>
      configureTaskAccess({ ...base, taskAccessAudience: 'https://worker.example' }, dir)
    ).toThrow('both');
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    writeFileSync(file, privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600 });
    expect(() => configureTaskAccess(configured, dir)).toThrow('public SPKI');
    writeFileSync(
      file,
      generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey.export({
        format: 'pem',
        type: 'spki',
      })
    );
    expect(() => configureTaskAccess(configured, dir)).toThrow('Ed25519');
    writeFileSync(file, publicKey.export({ format: 'pem', type: 'spki' }));
    const config = configureTaskAccess(configured, dir);
    expect(config?.key.type).toBe('public');
    expect(config?.audience).toBe('https://worker.example/test');
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
    vi.stubGlobal('fetch', fetch);
    expect(await config?.resolveLegacy('task-a')).toBeNull();
    expect(fetch).toHaveBeenCalledWith(
      'https://app.example/internal/tasks/task-a/dispatch-metadata',
      expect.objectContaining({ redirect: 'error' })
    );
    chmodSync(dir, 0o777);
    expect(() => configureTaskAccess(configured, dir)).toThrow(
      'Unsafe task verification key directory'
    );
    chmodSync(dir, 0o700);
    chmodSync(file, 0o666);
    expect(() => configureTaskAccess(configured, dir)).toThrow('permissions');
  } finally {
    vi.unstubAllGlobals();
    rmSync(dir, { recursive: true, force: true });
  }
});
