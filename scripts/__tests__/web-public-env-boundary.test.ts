import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const PRIVATE_SENTINEL = 'private-web-sentinel-must-never-ship';
const PUBLIC_ENV_KEYS = [
  'INTEXURAOS_AUTH0_DOMAIN',
  'INTEXURAOS_AUTH0_SPA_CLIENT_ID',
  'INTEXURAOS_AUTH_AUDIENCE',
  'INTEXURAOS_FIREBASE_PROJECT_ID',
  'INTEXURAOS_FIREBASE_API_KEY',
  'INTEXURAOS_FIREBASE_AUTH_DOMAIN',
  'INTEXURAOS_SENTRY_DSN_WEB',
  'INTEXURAOS_USE_FIREBASE_EMULATORS',
] as const;

function readRequired(path: string): string {
  return readFileSync(resolve(ROOT, path), 'utf8');
}

function readTree(path: string): string {
  return readdirSync(path, { withFileTypes: true })
    .flatMap((entry) => {
      const child = join(path, entry.name);
      if (entry.isDirectory()) return readTree(child);
      if (!entry.isFile() || statSync(child).size === 0) return '';
      return readFileSync(child, 'utf8');
    })
    .join('\n');
}

describe('web public environment boundary', () => {
  it('uses one exact typed allowlist and no dynamic import.meta.env access', () => {
    const publicEnv = readRequired('apps/web/src/publicEnv.ts');
    const config = readRequired('apps/web/src/config.ts');
    const firebase = readRequired('apps/web/src/services/firebase.ts');
    const vite = readRequired('apps/web/vite.config.ts');

    for (const key of PUBLIC_ENV_KEYS) expect(publicEnv).toContain(`'${key}'`);
    expect(publicEnv).toContain('PUBLIC_WEB_ENV_KEYS');
    expect(config).not.toContain('import.meta.env[');
    expect(firebase).not.toContain('import.meta.env[');
    expect(vite).not.toContain("loadEnv(mode, process.cwd(), 'INTEXURAOS_')");
    expect(vite).not.toContain("envPrefix: 'INTEXURAOS_'");
    expect(vite).not.toContain("key.startsWith('INTEXURAOS_')");
  });

  it('does not pass the ambient PM2 environment to the web process', () => {
    const ecosystem = readRequired('ecosystem.config.cjs');

    expect(ecosystem).not.toContain("name: 'web'");
    expect(ecosystem).not.toContain('node_modules/vite/bin/vite.js');
  });

  it('keeps every policy secret and a private sentinel out of built assets and source maps', () => {
    const output = mkdtempSync(join(tmpdir(), 'intexuraos-web-public-env-'));
    const policy = JSON.parse(readRequired('config/environments/policy.json')) as {
      secretManagerNames: string[];
    };
    const privateEnv = Object.fromEntries(
      policy.secretManagerNames.map((name) => [name, PRIVATE_SENTINEL])
    );
    const result = spawnSync(
      process.execPath,
      [
        resolve(ROOT, 'node_modules/vite/bin/vite.js'),
        'build',
        '--mode',
        'production',
        '--outDir',
        output,
      ],
      {
        cwd: resolve(ROOT, 'apps/web'),
        encoding: 'utf8',
        env: {
          HOME: process.env.HOME ?? tmpdir(),
          PATH: process.env.PATH ?? '',
          ...privateEnv,
          INTEXURAOS_AUTH0_DOMAIN: 'public-auth.example',
          INTEXURAOS_AUTH0_SPA_CLIENT_ID: 'public-spa-client',
          INTEXURAOS_AUTH_AUDIENCE: 'public-audience',
          INTEXURAOS_FIREBASE_PROJECT_ID: 'public-firebase-project',
          INTEXURAOS_FIREBASE_API_KEY: 'public-restricted-firebase-browser-key',
          INTEXURAOS_FIREBASE_AUTH_DOMAIN: 'public.firebaseapp.com',
          INTEXURAOS_SENTRY_DSN_WEB: 'https://public@sentry.example/1',
          INTEXURAOS_USE_FIREBASE_EMULATORS: 'false',
        },
      }
    );

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const built = readTree(output);
    expect(built).toContain('public-restricted-firebase-browser-key');
    expect(built.includes(PRIVATE_SENTINEL)).toBe(false);
    for (const name of policy.secretManagerNames) expect(built.includes(name)).toBe(false);
  }, 30_000);
});
