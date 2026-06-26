import { type SpawnSyncReturns, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const SCRIPT = path.resolve(import.meta.dirname, '..', 'verify-route-resource-names.mjs');

function writeFixture(rootDir: string, relativePath: string, body: string): void {
  const fullPath = path.join(rootDir, relativePath);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, body);
}

function writeManifest(rootDir: string): void {
  writeFixture(
    rootDir,
    'apps/web/service-manifest.json',
    JSON.stringify({
      services: [
        {
          name: 'linear-agent',
          envSuffix: 'LINEAR_AGENT',
          apiPath: '/api/linear',
          proxyTarget: 'http://localhost:8126',
          serviceUrl: 'http://localhost:8126',
        },
        {
          name: 'whatsapp-service',
          envSuffix: 'WHATSAPP_SERVICE',
          apiPath: '/api/whatsapp',
          proxyTarget: 'http://localhost:8113',
          serviceUrl: 'http://localhost:8113',
        },
        {
          name: 'notion-service',
          envSuffix: 'NOTION_SERVICE',
          apiPath: '/api/notion',
          proxyTarget: 'http://localhost:8112',
          serviceUrl: 'http://localhost:8112',
        },
        {
          name: 'mobile-notifications-service',
          envSuffix: 'MOBILE_NOTIFICATIONS_SERVICE',
          apiPath: '/api/notifications',
          proxyTarget: 'http://localhost:8114',
          serviceUrl: 'http://localhost:8114',
        },
        {
          name: 'calendar-agent',
          envSuffix: 'CALENDAR_AGENT',
          apiPath: '/api/calendar',
          proxyTarget: 'http://localhost:8125',
          serviceUrl: 'http://localhost:8125',
        },
        {
          name: 'code-agent',
          envSuffix: 'CODE_AGENT',
          apiPath: '/api/code',
          proxyTarget: 'http://localhost:8128',
          serviceUrl: 'http://localhost:8128',
        },
      ],
    })
  );
}

function runScript(rootDir: string): SpawnSyncReturns<string> {
  return spawnSync('node', [SCRIPT, '--root', rootDir], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

describe('verify-route-resource-names', () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = mkdtempSync(path.join(tmpdir(), 'verify-route-resource-names-'));
    writeManifest(rootDir);
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('does not retain route aliases for removed agents', () => {
    const source = readFileSync(SCRIPT, 'utf8');

    expect(source).not.toContain(`['${['cron', 'agent'].join('-')}'`);
  });

  it('fails when a public route repeats its service mount resource', () => {
    writeFixture(
      rootDir,
      'apps/linear-agent/src/routes.ts',
      `
export async function routes(fastify) {
  fastify.get('/linear/issues', async () => ({}));
}
`
    );

    const result = runScript(rootDir);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/route resource name verification failed/i);
    expect(result.stderr).toMatch(/apps\/linear-agent\/src\/routes\.ts:3/);
    expect(result.stderr).toMatch(/\/linear\/issues/);
  });

  it('passes normalized routes and ignored service endpoints', () => {
    writeFixture(
      rootDir,
      'apps/linear-agent/src/routes.ts',
      `
export async function routes(fastify) {
  fastify.get('/issues', async () => ({}));
  fastify.get('/internal/linear/sync', async () => ({}));
  fastify.get('/health', async () => ({}));
  fastify.get('/openapi.json', async () => ({}));
  fastify.get('/docs', async () => ({}));
}
`
    );

    const result = runScript(rootDir);

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/Route resource names valid/);
  });

  it('passes canonical provider webhook routes', () => {
    writeFixture(
      rootDir,
      'apps/linear-agent/src/routes.ts',
      `
export async function routes(fastify) {
  fastify.post('/webhooks', async () => ({}));
}
`
    );
    writeFixture(
      rootDir,
      'apps/whatsapp-service/src/routes.ts',
      `
export async function routes(fastify) {
  fastify.get('/webhooks', async () => ({}));
  fastify.post('/webhooks', async () => ({}));
}
`
    );
    writeFixture(
      rootDir,
      'apps/notion-service/src/routes.ts',
      `
export async function routes(fastify) {
  fastify.post('/webhooks', async () => ({}));
}
`
    );
    writeFixture(
      rootDir,
      'apps/code-agent/src/routes.ts',
      `
export async function routes(fastify) {
  fastify.post('/webhooks/github', async () => ({}));
}
`
    );

    const result = runScript(rootDir);

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/Route resource names valid/);
  });

  it('fails legacy Linear singular webhook route', () => {
    writeFixture(
      rootDir,
      'apps/linear-agent/src/routes.ts',
      `
export async function routes(fastify) {
  fastify.post('/webhook', async () => ({}));
}
`
    );

    const result = runScript(rootDir);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/linear-agent/);
    expect(result.stderr).toMatch(/\/webhook/);
  });

  it('fails nested WhatsApp webhook provider route', () => {
    writeFixture(
      rootDir,
      'apps/whatsapp-service/src/routes.ts',
      `
export async function routes(fastify) {
  fastify.post('/webhooks/whatsapp', async () => ({}));
}
`
    );

    const result = runScript(rootDir);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/whatsapp-service/);
    expect(result.stderr).toMatch(/\/webhooks\/whatsapp/);
  });

  it('fails legacy Notion webhook mount route', () => {
    writeFixture(
      rootDir,
      'apps/notion-service/src/routes.ts',
      `
export async function routes(fastify) {
  fastify.post('/notion-webhooks', async () => ({}));
}
`
    );

    const result = runScript(rootDir);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/notion-service/);
    expect(result.stderr).toMatch(/\/notion-webhooks/);
  });

  it('fails changed code-agent GitHub webhook route', () => {
    writeFixture(
      rootDir,
      'apps/code-agent/src/routes.ts',
      `
export async function routes(fastify) {
  fastify.post('/github/webhooks', async () => ({}));
}
`
    );

    const result = runScript(rootDir);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/code-agent/);
    expect(result.stderr).toMatch(/\/github\/webhooks/);
  });

  it('fails known alias route prefixes for services with historical mounts', () => {
    writeFixture(
      rootDir,
      'apps/mobile-notifications-service/src/routes.ts',
      `
export async function routes(fastify) {
  fastify.post('/mobile-notifications/devices', async () => ({}));
}
`
    );

    const result = runScript(rootDir);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/mobile-notifications-service/);
    expect(result.stderr).toMatch(/\/mobile-notifications\/devices/);
  });

  it('fails frontend service-base calls that repeat the service mount resource', () => {
    writeFixture(
      rootDir,
      'apps/web/src/services/linearApi.ts',
      `
export async function listIssues(config, accessToken) {
  return apiRequest(config.linearAgentUrl, '/linear/issues', accessToken);
}
`
    );

    const result = runScript(rootDir);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/frontend/);
    expect(result.stderr).toMatch(/apps\/web\/src\/services\/linearApi\.ts:3/);
    expect(result.stderr).toMatch(/config\.linearAgentUrl/);
    expect(result.stderr).toMatch(/\/linear\/issues/);
  });

  it('fails frontend service-base template calls that repeat the service mount resource', () => {
    writeFixture(
      rootDir,
      'apps/web/src/services/codeTasksApi.ts',
      `
export async function listCodeTasks(config, query, accessToken) {
  return apiRequest(config.codeAgentUrl, \`/code/tasks\${query}\`, accessToken);
}
`
    );

    const result = runScript(rootDir);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/frontend/);
    expect(result.stderr).toMatch(/apps\/web\/src\/services\/codeTasksApi\.ts:3/);
    expect(result.stderr).toMatch(/config\.codeAgentUrl/);
    expect(result.stderr).toMatch(/\/code\/tasks/);
  });

  it('fails YAML service-base entries that repeat the service mount resource', () => {
    writeFixture(
      rootDir,
      'apps/web/src/config/calendar-config.yaml',
      `
calendar:
  preview:
    endpoint:
      path: /calendar/events
      method: POST
      baseUrl: \${INTEXURAOS_CALENDAR_AGENT_URL}
`
    );

    const result = runScript(rootDir);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/action-config/);
    expect(result.stderr).toMatch(/INTEXURAOS_CALENDAR_AGENT_URL/);
    expect(result.stderr).toMatch(/\/calendar\/events/);
  });

  it('fails e2e code-agent service-base calls that repeat the service mount resource', () => {
    writeFixture(
      rootDir,
      'e2e/tests/code-tasks.spec.ts',
      `
export async function listCodeTasks(client) {
  return client.get('/code/tasks');
}
`
    );

    const result = runScript(rootDir);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/e2e/);
    expect(result.stderr).toMatch(/e2e\/tests\/code-tasks\.spec\.ts:3/);
    expect(result.stderr).toMatch(/\/code\/tasks/);
  });
});
