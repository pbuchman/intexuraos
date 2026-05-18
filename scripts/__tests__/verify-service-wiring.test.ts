import { execFileSync, spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  generateServiceWiring,
  loadServiceManifest,
  renderPublicServiceEnv,
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
import { WEB_SERVICE_URLS } from './config.generated';
function getServiceUrl(envVar, apiPath) { return apiPath; }
const generatedServiceUrls = Object.fromEntries(WEB_SERVICE_URLS.map(({ envVar, apiPath }) => [envVar, getServiceUrl(envVar, apiPath)]));
export function getConfig() {
  return {
    authServiceUrl: generatedServiceUrls.INTEXURAOS_USER_SERVICE_URL,
    codeAgentUrl: generatedServiceUrls.INTEXURAOS_CODE_AGENT_URL,
  };
}
`;

const VITE_FIXTURE = `
import { WEB_SERVICE_URLS } from './src/config.generated';
const apiProxy = Object.fromEntries(WEB_SERVICE_URLS.map(({ apiPath, proxyTarget }) => [
  apiPath,
  { target: proxyTarget, rewrite: (p) => p.replace(new RegExp('^' + apiPath), '') },
]));
`;

const ECOSYSTEM_FIXTURE = `
const { COMMON_SERVICE_URLS_GENERATED } = require('./ecosystem.generated.cjs');
const COMMON_SERVICE_URLS = {
  ...COMMON_SERVICE_URLS_GENERATED,
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
      {
        envVar: 'INTEXURAOS_USER_SERVICE_URL',
        apiPath: '/api/user',
        proxyTarget: 'http://localhost:8110',
      },
      {
        envVar: 'INTEXURAOS_CODE_AGENT_URL',
        apiPath: '/api/code',
        proxyTarget: 'http://localhost:8128',
      },
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

  it('fails when vite config does not consume generated service URLs', () => {
    writeFixture(rootDir, 'apps/web/service-manifest.json', MANIFEST_FIXTURE);
    writeFixture(rootDir, 'apps/web/src/config.ts', CONFIG_FIXTURE);
    writeGeneratedFixture(rootDir);
    writeFixture(
      rootDir,
      'apps/web/vite.config.ts',
      `
const apiProxy = {
  '/api/user': { target: 'http://localhost:8110' },
  '/api/code': { target: 'http://localhost:8128' },
};
`
    );
    writeFixture(rootDir, 'ecosystem.config.cjs', ECOSYSTEM_FIXTURE);

    const result = runScript(rootDir);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/apps\/web\/vite\.config\.ts must import WEB_SERVICE_URLS/);
  });

  it('fails when ecosystem config does not consume generated service URLs', () => {
    writeFixture(rootDir, 'apps/web/service-manifest.json', MANIFEST_FIXTURE);
    writeFixture(rootDir, 'apps/web/src/config.ts', CONFIG_FIXTURE);
    writeFixture(rootDir, 'apps/web/vite.config.ts', VITE_FIXTURE);
    writeGeneratedFixture(rootDir);
    writeFixture(
      rootDir,
      'ecosystem.config.cjs',
      ECOSYSTEM_FIXTURE.replace(
        "const { COMMON_SERVICE_URLS_GENERATED } = require('./ecosystem.generated.cjs');\n",
        ''
      ).replace('...COMMON_SERVICE_URLS_GENERATED,\n', '')
    );

    const result = runScript(rootDir);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/ecosystem\.config\.cjs must require ecosystem\.generated\.cjs/);
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

  it('renders public service env values from manifest API paths', () => {
    writeFixture(rootDir, 'apps/web/service-manifest.json', MANIFEST_FIXTURE);
    const manifest = loadServiceManifest(path.join(rootDir, 'apps/web/service-manifest.json'));
    const wiring = generateServiceWiring(manifest);

    expect(renderPublicServiceEnv(wiring, 'https://intexuraos.cloud/')).toBe(
      [
        'INTEXURAOS_USER_SERVICE_URL=https://intexuraos.cloud/api/user',
        'INTEXURAOS_CODE_AGENT_URL=https://intexuraos.cloud/api/code',
        '',
      ].join('\n')
    );
  });

  it('prints public service env values from the CLI', () => {
    writeFixture(rootDir, 'apps/web/service-manifest.json', MANIFEST_FIXTURE);

    const output = execFileSync(
      'node',
      [
        GENERATOR_SCRIPT,
        '--root',
        rootDir,
        '--public-env',
        '--base-url',
        'https://intexuraos.cloud',
      ],
      { encoding: 'utf-8' }
    );

    expect(output).toContain('INTEXURAOS_USER_SERVICE_URL=https://intexuraos.cloud/api/user');
    expect(output).toContain('INTEXURAOS_CODE_AGENT_URL=https://intexuraos.cloud/api/code');
  });

  it('rejects malformed public base URLs', () => {
    writeFixture(rootDir, 'apps/web/service-manifest.json', MANIFEST_FIXTURE);

    const result = spawnSync(
      'node',
      [GENERATOR_SCRIPT, '--root', rootDir, '--public-env', '--base-url', 'not-a-url'],
      { encoding: 'utf-8' }
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--base-url requires an absolute http(s) URL');
  });
});
