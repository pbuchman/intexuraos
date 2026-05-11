import { execFileSync, spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  generateServiceWiring,
  loadServiceManifest,
  writeServiceWiringArtifacts,
} from '../generate-service-wiring.mjs';

const SCRIPT = path.resolve(import.meta.dirname, '..', 'verify-service-wiring.mjs');
const GENERATOR_SCRIPT = path.resolve(import.meta.dirname, '..', 'generate-service-wiring.mjs');

const MANIFEST_FIXTURE = JSON.stringify(
  {
    services: [
      {
        name: 'user-service',
        envSuffix: 'USER_SERVICE',
        apiPath: '/api/user',
        proxyTarget: 'http://localhost:8110',
        serviceUrl: 'http://localhost:8110',
      },
      {
        name: 'code-agent',
        envSuffix: 'CODE_AGENT',
        apiPath: '/api/code',
        proxyTarget: 'http://localhost:8128',
        serviceUrl: 'https://dev.intexuraos.cloud/api/code',
      },
    ],
  },
  null,
  2
);

const CONFIG_FIXTURE = `
function getServiceUrl(envVar, apiPath) { return apiPath; }
export function getConfig() {
  return {
    authServiceUrl: getServiceUrl('INTEXURAOS_USER_SERVICE_URL', '/api/user'),
    codeAgentUrl: getServiceUrl('INTEXURAOS_CODE_AGENT_URL', '/api/code'),
  };
}
`;

const VITE_FIXTURE = `
const apiProxy = {
  '/api/user': { target: 'http://localhost:8110', rewrite: (p) => p.replace(/^\\/api\\/user/, '') },
  '/api/code': { target: 'http://localhost:8128', rewrite: (p) => p.replace(/^\\/api\\/code/, '') },
};
`;

const ECOSYSTEM_FIXTURE = `
const COMMON_SERVICE_URLS = {
  INTEXURAOS_USER_SERVICE_URL: 'http://localhost:8110',
  INTEXURAOS_CODE_AGENT_URL: 'https://dev.intexuraos.cloud/api/code',
  INTEXURAOS_API_DOCS_HUB_URL: 'http://localhost:8133',
};
module.exports = { apps: [] };
`;

function writeFixture(rootDir: string, relativePath: string, body: string): string {
  const fullPath = path.join(rootDir, relativePath);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, body);
  return fullPath;
}

function runScript(rootDir: string) {
  return spawnSync('node', [SCRIPT, '--root', rootDir], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function writeGeneratedFixture(rootDir: string): void {
  const manifest = loadServiceManifest(path.join(rootDir, 'apps/web/service-manifest.json'));
  writeServiceWiringArtifacts(rootDir, generateServiceWiring(manifest));
}

describe('verify-service-wiring', () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = mkdtempSync(path.join(tmpdir(), 'verify-service-wiring-'));
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('generates normalized env vars from the manifest', () => {
    const manifestPath = writeFixture(rootDir, 'apps/web/service-manifest.json', MANIFEST_FIXTURE);
    const manifest = loadServiceManifest(manifestPath);
    const wiring = generateServiceWiring(manifest);

    expect(wiring.configEntries).toEqual([
      { envVar: 'INTEXURAOS_USER_SERVICE_URL', apiPath: '/api/user' },
      { envVar: 'INTEXURAOS_CODE_AGENT_URL', apiPath: '/api/code' },
    ]);
    expect(wiring.proxyEntries).toEqual([
      { apiPath: '/api/user', target: 'http://localhost:8110' },
      { apiPath: '/api/code', target: 'http://localhost:8128' },
    ]);
    expect(wiring.commonServiceUrls).toEqual([
      { envVar: 'INTEXURAOS_USER_SERVICE_URL', url: 'http://localhost:8110' },
      { envVar: 'INTEXURAOS_CODE_AGENT_URL', url: 'https://dev.intexuraos.cloud/api/code' },
    ]);
  });

  it('passes when manifest, config, vite proxy, and ecosystem wiring agree', () => {
    writeFixture(rootDir, 'apps/web/service-manifest.json', MANIFEST_FIXTURE);
    writeFixture(rootDir, 'apps/web/src/config.ts', CONFIG_FIXTURE);
    writeFixture(rootDir, 'apps/web/vite.config.ts', VITE_FIXTURE);
    writeFixture(rootDir, 'ecosystem.config.cjs', ECOSYSTEM_FIXTURE);
    writeGeneratedFixture(rootDir);

    const result = runScript(rootDir);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/Service wiring verified/);
  });

  it('fails when vite proxy target drifts from the manifest', () => {
    writeFixture(rootDir, 'apps/web/service-manifest.json', MANIFEST_FIXTURE);
    writeFixture(rootDir, 'apps/web/src/config.ts', CONFIG_FIXTURE);
    writeGeneratedFixture(rootDir);
    writeFixture(
      rootDir,
      'apps/web/vite.config.ts',
      VITE_FIXTURE.replace('http://localhost:8128', 'http://localhost:9999')
    );
    writeFixture(rootDir, 'ecosystem.config.cjs', ECOSYSTEM_FIXTURE);

    const result = runScript(rootDir);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(
      /apps\/web\/vite\.config\.ts has \/api\/code -> http:\/\/localhost:9999; expected http:\/\/localhost:8128/
    );
  });

  it('fails when ecosystem COMMON_SERVICE_URLS is missing a manifest env var', () => {
    writeFixture(rootDir, 'apps/web/service-manifest.json', MANIFEST_FIXTURE);
    writeFixture(rootDir, 'apps/web/src/config.ts', CONFIG_FIXTURE);
    writeFixture(rootDir, 'apps/web/vite.config.ts', VITE_FIXTURE);
    writeGeneratedFixture(rootDir);
    writeFixture(
      rootDir,
      'ecosystem.config.cjs',
      ECOSYSTEM_FIXTURE.replace(
        "  INTEXURAOS_CODE_AGENT_URL: 'https://dev.intexuraos.cloud/api/code',\n",
        ''
      )
    );

    const result = runScript(rootDir);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/COMMON_SERVICE_URLS is missing INTEXURAOS_CODE_AGENT_URL/);
  });

  it('passes against the real repo files', () => {
    const output = execFileSync('node', [SCRIPT], { encoding: 'utf-8' });
    expect(output).toMatch(/Service wiring verified/);
  });

  it('writes the required generated service-wiring artifacts', () => {
    writeFixture(rootDir, 'apps/web/service-manifest.json', MANIFEST_FIXTURE);

    const output = execFileSync('node', [GENERATOR_SCRIPT, '--root', rootDir], {
      encoding: 'utf-8',
    });

    expect(output).toMatch(/Generated service wiring artifacts/);
    const configPath = path.join(rootDir, 'apps/web/src/config.generated.ts');
    const ecosystemPath = path.join(rootDir, 'ecosystem.generated.cjs');
    const terraformPath = path.join(
      rootDir,
      'terraform/environments/dev/service-urls.auto.tfvars.json'
    );

    expect(existsSync(configPath)).toBe(true);
    expect(existsSync(ecosystemPath)).toBe(true);
    expect(existsSync(terraformPath)).toBe(true);
    expect(readFileSync(configPath, 'utf8')).toContain('INTEXURAOS_CODE_AGENT_URL');
    expect(readFileSync(ecosystemPath, 'utf8')).toContain('INTEXURAOS_USER_SERVICE_URL');
    expect(JSON.parse(readFileSync(terraformPath, 'utf8'))).toEqual({
      service_urls: {
        INTEXURAOS_CODE_AGENT_URL: 'https://dev.intexuraos.cloud/api/code',
        INTEXURAOS_USER_SERVICE_URL: 'http://localhost:8110',
      },
    });
  });
});
