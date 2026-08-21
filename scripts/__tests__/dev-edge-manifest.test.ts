import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '..', '..');
const manifestPath = resolve(repoRoot, 'config', 'edge', 'dev-access.json');
const generatorPath = resolve(repoRoot, 'scripts', 'generate-dev-caddy.mjs');

const EXPECTED_MACHINE_ROUTES = [
  ['POST', '/api/code/internal/webhooks/task-complete', 'per-task-hmac-timestamp'],
  ['POST', '/api/code/internal/logs', 'per-task-hmac-timestamp'],
  ['POST', '/api/code/internal/turn-metrics', 'per-task-hmac-timestamp'],
  ['POST', '/api/code/internal/webhooks/task-event', 'per-task-hmac-timestamp'],
  ['POST', '/api/code/internal/webhooks/compliance-report', 'per-task-hmac-timestamp-internal-auth'],
  ['PATCH', '/api/code/internal/code-tasks/status', 'task-or-orchestrator-hmac'],
  ['POST', '/api/linear/webhooks', 'linear-signature'],
  ['POST', '/api/notifications/webhooks', 'mobile-signature'],
  ['POST', '/api/code/webhooks/sentry', 'sentry-hook-signature'],
] as const;

describe('DEV edge manifest', () => {
  it('freezes the exact external machine paths and guards without wildcards', () => {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      browserIdentity: string;
      host: string;
      machineRoutes: { guard: string; method: string; path: string }[];
      schemaVersion: number;
    };

    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.host).toBe('dev.intexuraos.cloud');
    expect(manifest.browserIdentity).toBe('kontakt@pbuchman.com');
    expect(manifest.machineRoutes.map(({ method, path, guard }) => [method, path, guard])).toEqual(
      EXPECTED_MACHINE_ROUTES
    );
    for (const route of manifest.machineRoutes) {
      expect(route.path).not.toMatch(/[{}*]/u);
    }
  });

  it('generates a static, redacted Caddy origin with method gates and no Vite/webhook deployer', () => {
    const output = execFileSync(process.execPath, [generatorPath], {
      cwd: repoRoot,
      encoding: 'utf8',
    });

    expect(output).toContain('dev.intexuraos.cloud:80');
    expect(output).toContain('root * /home/pbuchman/deploy/intexuraos/apps/web/dist');
    expect(output).toContain('file_server');
    expect(output).toContain('format json');
    expect(output).not.toContain('localhost:3000');
    expect(output).not.toContain('localhost:9000');
    for (const [method, path] of EXPECTED_MACHINE_ROUTES) {
      expect(output).toContain(`method ${method}`);
      expect(output).toContain(`path ${path}`);
    }
  });
});
