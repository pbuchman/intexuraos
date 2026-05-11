import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

const SCRIPT = path.resolve(__dirname, '../check-web-env-lockstep.cjs');

const MANIFEST_FIXTURE = JSON.stringify({
  services: [
    { name: 'user-service', envSuffix: 'USER_SERVICE' },
    { name: 'image-service', envSuffix: 'IMAGE_SERVICE' },
  ],
});

const CONFIG_FIXTURE = `
import type { AppConfig } from '@/types';
function getServiceUrl(envVar: string, apiPath: string): string { return apiPath; }
export function getConfig(): AppConfig {
  return {
    authServiceUrl: getServiceUrl('INTEXURAOS_USER_SERVICE_URL', '/api/user'),
    imageServiceUrl: getServiceUrl('INTEXURAOS_IMAGE_SERVICE_URL', '/api/images'),
  } as AppConfig;
}
`;

const GENERATED_CONFIG_FIXTURE = `
export const WEB_SERVICE_URLS = [
  { envVar: 'INTEXURAOS_USER_SERVICE_URL', apiPath: '/api/user', proxyTarget: 'http://localhost:8110' },
  { envVar: 'INTEXURAOS_IMAGE_SERVICE_URL', apiPath: '/api/images', proxyTarget: 'http://localhost:8120' },
] as const;
`;

const GENERATED_CONSUMING_CONFIG_FIXTURE = `
import { WEB_SERVICE_URLS } from './config.generated';
function getServiceUrl(envVar: string, apiPath: string): string { return apiPath; }
const urls = Object.fromEntries(WEB_SERVICE_URLS.map(({ envVar, apiPath }) => [envVar, getServiceUrl(envVar, apiPath)]));
export function getConfig() {
  return {
    authServiceUrl: urls.INTEXURAOS_USER_SERVICE_URL,
    imageServiceUrl: urls.INTEXURAOS_IMAGE_SERVICE_URL,
  };
}
`;

const DEPLOY_FIXTURE = `
jobs:
  monolith:
    steps:
      - run: |
          CLOUD_RUN_SERVICES=(
            "user-service:USER_SERVICE"
            "image-service:IMAGE_SERVICE"
          )
  individual:
    steps:
      - run: |
          CLOUD_RUN_SERVICES=(
            "user-service:USER_SERVICE"
            "image-service:IMAGE_SERVICE"
          )
`;

describe('check-web-env-lockstep', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'lockstep-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function run(env: Record<string, string>) {
    return spawnSync('node', [SCRIPT], {
      encoding: 'utf-8',
      env: { ...process.env, ...env },
    });
  }

  function writeFixture(name: string, body: string) {
    const p = path.join(dir, name);
    writeFileSync(p, body);
    return p;
  }

  test('passes when manifest, config, and both deploy.yml arrays agree', () => {
    const r = run({
      WEB_ENV_LOCKSTEP_MANIFEST: writeFixture('service-manifest.json', MANIFEST_FIXTURE),
      WEB_ENV_LOCKSTEP_CONFIG: writeFixture('config.ts', CONFIG_FIXTURE),
      WEB_ENV_LOCKSTEP_DEPLOY_YML: writeFixture('deploy.yml', DEPLOY_FIXTURE),
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/lockstep OK/);
  });

  test('passes when config consumes service URLs through generated wiring', () => {
    const r = run({
      WEB_ENV_LOCKSTEP_MANIFEST: writeFixture('service-manifest.json', MANIFEST_FIXTURE),
      WEB_ENV_LOCKSTEP_CONFIG: writeFixture('config.ts', GENERATED_CONSUMING_CONFIG_FIXTURE),
      WEB_ENV_LOCKSTEP_CONFIG_GENERATED: writeFixture(
        'config.generated.ts',
        GENERATED_CONFIG_FIXTURE
      ),
      WEB_ENV_LOCKSTEP_DEPLOY_YML: writeFixture('deploy.yml', DEPLOY_FIXTURE),
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/lockstep OK/);
  });

  test('fails when deploy.yml array is missing an entry that manifest has', () => {
    const driftedDeploy = DEPLOY_FIXTURE.replaceAll('"image-service:IMAGE_SERVICE"\n', '');
    const r = run({
      WEB_ENV_LOCKSTEP_MANIFEST: writeFixture('service-manifest.json', MANIFEST_FIXTURE),
      WEB_ENV_LOCKSTEP_CONFIG: writeFixture('config.ts', CONFIG_FIXTURE),
      WEB_ENV_LOCKSTEP_DEPLOY_YML: writeFixture('deploy.yml', driftedDeploy),
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/deploy\.yml\[0\] is missing INTEXURAOS_IMAGE_SERVICE_URL/);
    expect(r.stderr).toMatch(/deploy\.yml\[1\] is missing INTEXURAOS_IMAGE_SERVICE_URL/);
  });

  test('fails when only one of the two deploy.yml arrays drifts', () => {
    const partialDrift = DEPLOY_FIXTURE.replace(
      /individual:[\s\S]*$/,
      `individual:
    steps:
      - run: |
          CLOUD_RUN_SERVICES=(
            "user-service:USER_SERVICE"
          )
`
    );
    const r = run({
      WEB_ENV_LOCKSTEP_MANIFEST: writeFixture('service-manifest.json', MANIFEST_FIXTURE),
      WEB_ENV_LOCKSTEP_CONFIG: writeFixture('config.ts', CONFIG_FIXTURE),
      WEB_ENV_LOCKSTEP_DEPLOY_YML: writeFixture('deploy.yml', partialDrift),
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/deploy\.yml\[1\] is missing INTEXURAOS_IMAGE_SERVICE_URL/);
    expect(r.stderr).not.toMatch(/deploy\.yml\[0\] is missing/);
  });

  test('fails when config.ts consumes an env var that the manifest does not list', () => {
    const driftedConfig = CONFIG_FIXTURE.replace(
      '} as AppConfig;',
      "    extraUrl: getServiceUrl('INTEXURAOS_NOPE_SERVICE_URL', '/api/nope'),\n  } as AppConfig;"
    );
    const r = run({
      WEB_ENV_LOCKSTEP_MANIFEST: writeFixture('service-manifest.json', MANIFEST_FIXTURE),
      WEB_ENV_LOCKSTEP_CONFIG: writeFixture('config.ts', driftedConfig),
      WEB_ENV_LOCKSTEP_DEPLOY_YML: writeFixture('deploy.yml', DEPLOY_FIXTURE),
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(
      /config\.ts consumes INTEXURAOS_NOPE_SERVICE_URL but cloudbuild does not fetch it/
    );
  });

  test('fails when manifest is invalid JSON', () => {
    const r = run({
      WEB_ENV_LOCKSTEP_MANIFEST: writeFixture('service-manifest.json', '{ not json'),
      WEB_ENV_LOCKSTEP_CONFIG: writeFixture('config.ts', CONFIG_FIXTURE),
      WEB_ENV_LOCKSTEP_DEPLOY_YML: writeFixture('deploy.yml', DEPLOY_FIXTURE),
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/service-manifest\.json is not valid JSON/);
  });

  test('fails when manifest is missing the services array', () => {
    const r = run({
      WEB_ENV_LOCKSTEP_MANIFEST: writeFixture('service-manifest.json', JSON.stringify({})),
      WEB_ENV_LOCKSTEP_CONFIG: writeFixture('config.ts', CONFIG_FIXTURE),
      WEB_ENV_LOCKSTEP_DEPLOY_YML: writeFixture('deploy.yml', DEPLOY_FIXTURE),
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/service-manifest\.json must have a "services" array/);
  });

  test('fails when a service entry is missing envSuffix', () => {
    const bad = JSON.stringify({
      services: [{ name: 'user-service', envSuffix: 'USER_SERVICE' }, { name: 'image-service' }],
    });
    const r = run({
      WEB_ENV_LOCKSTEP_MANIFEST: writeFixture('service-manifest.json', bad),
      WEB_ENV_LOCKSTEP_CONFIG: writeFixture('config.ts', CONFIG_FIXTURE),
      WEB_ENV_LOCKSTEP_DEPLOY_YML: writeFixture('deploy.yml', DEPLOY_FIXTURE),
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/services\[1\] is missing string "envSuffix"/);
  });

  test('passes against the real repo files (regression guard)', () => {
    const out = execFileSync('node', [SCRIPT], { encoding: 'utf-8' });
    expect(out).toMatch(/lockstep OK/);
  });
});
