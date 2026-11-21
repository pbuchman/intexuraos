import * as os from 'node:os';
import { generateKeyPairSync } from 'node:crypto';
import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadLegacyTaskBindings, loadTaskAccessKey } from '../../../infra/services/taskAccessKey.js';

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  return { ...actual, userInfo: vi.fn(actual.userInfo) };
});

describe('code-agent signing mount', () => {
  let dir: string;
  let keyPath: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'code-agent-signing-test-'));
    keyPath = join(dir, 'key.pem');
  });
  afterEach(() => { rmSync(dir, { force: true, recursive: true }); });

  it('accepts a protected Ed25519 key and rejects unsafe modes and symlinks', () => {
    const { privateKey } = generateKeyPairSync('ed25519');
    writeFileSync(keyPath, privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600 });
    expect(loadTaskAccessKey(keyPath)?.asymmetricKeyType).toBe('ed25519');
    chmodSync(keyPath, 0o644);
    expect(() => loadTaskAccessKey(keyPath)).toThrow('permissions');
    const link = join(dir, 'link');
    symlinkSync(keyPath, link);
    expect(() => loadTaskAccessKey(link)).toThrow();
    expect(loadTaskAccessKey(undefined)).toBeUndefined();
  });

  it('denies the shared Home PROD UID before opening the signing mount', () => {
    const account = os.userInfo();
    vi.mocked(os.userInfo).mockReturnValueOnce({ ...account, username: 'intexuraos-prod' });
    expect(() => loadTaskAccessKey(keyPath)).toThrow('Shared Home PROD');
  });

  it('rejects a shared signing directory before opening the private key', () => {
    chmodSync(dir, 0o755);
    expect(() => loadTaskAccessKey(keyPath)).toThrow('Unsafe task signing mount directory');
  });

  it('rejects another key type', () => {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    writeFileSync(keyPath, privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600 });
    expect(() => loadTaskAccessKey(keyPath)).toThrow('Ed25519');
  });

  it('requires unambiguous owner-specific destinations for historical tasks', () => {
    const mapping = join(dir, 'legacy-worker-bindings.json');
    const entry = { ownerId: 'user-a', worker: 'worker-a', audience: 'https://worker.example/' };
    expect(loadLegacyTaskBindings(undefined)).toEqual([]);
    expect(loadLegacyTaskBindings(keyPath)).toEqual([]);
    writeFileSync(mapping, JSON.stringify([entry]), { mode: 0o600 });
    expect(loadLegacyTaskBindings(keyPath)).toEqual([{ ...entry, audience: 'https://worker.example' }]);
    writeFileSync(mapping, JSON.stringify([entry, entry]));
    expect(() => loadLegacyTaskBindings(keyPath)).toThrow('Ambiguous');
    chmodSync(mapping, 0o644);
    expect(() => loadLegacyTaskBindings(keyPath)).toThrow('permissions');
  });
});
