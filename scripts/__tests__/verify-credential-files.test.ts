import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanCredentialFiles } from '../verify-credential-files.mjs';

describe('credential file guard', () => {
  it('rejects provider-shaped service-account JSON without printing private material', () => {
    const root = mkdtempSync(join(tmpdir(), 'credential-guard-'));
    mkdirSync(join(root, 'config'));
    const sentinel = 'private-material-that-must-not-appear';
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 1024 });
    const privateKeyPem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
    writeFileSync(
      join(root, 'config', 'innocent-name.json'),
      JSON.stringify({
        type: 'service_account',
        client_email: 'runtime@example.iam.gserviceaccount.com',
        private_key: privateKeyPem,
        project_id: sentinel,
      })
    );

    const result = scanCredentialFiles({ root });

    expect(result.ok).toBe(false);
    expect(result.violations).toEqual([
      expect.objectContaining({
        path: 'config/innocent-name.json',
        reason: 'service-account-json',
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain(sentinel);
  });

  it('ignores dependencies and accepts ordinary config JSON', () => {
    const root = mkdtempSync(join(tmpdir(), 'credential-guard-'));
    mkdirSync(join(root, 'config'));
    mkdirSync(join(root, 'node_modules'));
    writeFileSync(join(root, 'config', 'public.json'), JSON.stringify({ enabled: true }));
    writeFileSync(
      join(root, 'node_modules', 'fixture.json'),
      JSON.stringify({ type: 'service_account', private_key: 'fixture' })
    );

    expect(scanCredentialFiles({ root })).toEqual({ ok: true, violations: [] });
  });

  it('rejects a complete secret-package payload under an arbitrary filename', () => {
    const root = mkdtempSync(join(tmpdir(), 'credential-guard-'));
    mkdirSync(join(root, 'config'));
    const sentinel = 'package-secret-that-must-not-appear';
    writeFileSync(
      join(root, 'config', 'innocent-release-notes.data'),
      JSON.stringify({
        schemaVersion: 1,
        environment: 'prod',
        env: {
          INTEXURAOS_FIREBASE_API_KEY: 'AIza' + 'a'.repeat(35),
          INTEXURAOS_INTERNAL_AUTH_TOKEN: sentinel,
        },
        files: {},
      })
    );

    const result = scanCredentialFiles({ root });

    expect(result).toEqual({
      ok: false,
      violations: [
        {
          path: 'config/innocent-release-notes.data',
          reason: 'secret-package-payload',
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain(sentinel);
  });

  it('rejects nested base64 service-account JSON and private-key material', () => {
    const root = mkdtempSync(join(tmpdir(), 'credential-guard-'));
    mkdirSync(join(root, 'config'));
    const sentinel = 'nested-private-material-that-must-not-appear';
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 1024 });
    const privateKeyPem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
    const serviceAccount = {
      type: 'service_account',
      client_email: 'runtime@example.iam.gserviceaccount.com',
      private_key: privateKeyPem,
      project_id: sentinel,
    };
    writeFileSync(
      join(root, 'config', 'nested-credential.json'),
      JSON.stringify({ encoded: Buffer.from(JSON.stringify(serviceAccount)).toString('base64') })
    );
    writeFileSync(
      join(root, 'config', 'encoded-key.json'),
      JSON.stringify({ encoded: Buffer.from(privateKeyPem).toString('base64') })
    );

    const result = scanCredentialFiles({ root });

    expect(result).toEqual({
      ok: false,
      violations: [
        { path: 'config/encoded-key.json', reason: 'private-key-material' },
        { path: 'config/nested-credential.json', reason: 'service-account-json' },
      ],
    });
    expect(JSON.stringify(result)).not.toContain(sentinel);
  });

  it('accepts tracked package manifests and inert fixture-shaped JSON', () => {
    const root = mkdtempSync(join(tmpdir(), 'credential-guard-'));
    mkdirSync(join(root, 'config'));
    const repoRoot = resolve(__dirname, '..', '..');
    for (const name of ['secret-packages.json', 'secret-package-sources.json']) {
      writeFileSync(
        join(root, 'config', name),
        readFileSync(join(repoRoot, 'config', 'environments', name), 'utf8')
      );
    }
    writeFileSync(
      join(root, 'config', 'fixture.json'),
      JSON.stringify({
        type: 'service_account',
        client_email: 'fixture@example.test',
        private_key: 'synthetic fixture value',
        environment: 'prod',
        files: {},
      })
    );

    expect(scanCredentialFiles({ root })).toEqual({ ok: true, violations: [] });
  });
});
