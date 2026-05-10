import { execFileSync, spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const SCRIPT = path.resolve(import.meta.dirname, '..', 'verify-envelope.mjs');

function writeRoute(rootDir: string, relativePath: string, body: string): void {
  const fullPath = path.join(rootDir, relativePath);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, body);
}

function runScript(rootDir: string) {
  return spawnSync('node', [SCRIPT, '--root', rootDir], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

describe('verify-envelope', () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = mkdtempSync(path.join(tmpdir(), 'verify-envelope-'));
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('passes when targeted internal routes use reply.ok and reply.fail', () => {
    writeRoute(
      rootDir,
      'apps/actions-agent/src/routes/internalRoutes.ts',
      `
export const routes = (fastify) => {
  fastify.post('/internal/actions', async (_request, reply) => {
    return await reply.ok({ actionId: 'act_123' });
  });
};
`
    );

    const result = runScript(rootDir);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/Internal envelopes verified/);
  });

  it('fails when a targeted internal route uses reply.send', () => {
    writeRoute(
      rootDir,
      'apps/bookmarks-agent/src/routes/internalRoutes.ts',
      `
export const routes = (fastify) => {
  fastify.post('/internal/bookmarks', async (_request, reply) => {
    return await reply.status(400).send({
      success: false,
      error: { code: 'INVALID_REQUEST', message: 'nope' },
    });
  });
};
`
    );

    const result = runScript(rootDir);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(
      /must use reply\.ok\(\)\/reply\.fail\(\) instead of reply\.send\(\)/
    );
    expect(result.stderr).toMatch(/\/internal\/bookmarks/);
  });

  it('ignores raw send in non-target routes', () => {
    writeRoute(
      rootDir,
      'apps/code-agent/src/routes/code/task-routes.ts',
      `
export const routes = (fastify) => {
  fastify.post('/code/tasks/:taskId/retry', async (_request, reply) => {
    return await reply.status(400).send({
      success: false,
      error: { code: 'INVALID_REQUEST', message: 'public route' },
    });
  });

  fastify.post('/internal/code/process', async (_request, reply) => {
    return await reply.ok({ codeTaskId: 'task_123', resourceUrl: 'http://localhost/resource' });
  });
};
`
    );

    const result = runScript(rootDir);
    expect(result.status).toBe(0);
  });

  it('passes against the real repo files', () => {
    const output = execFileSync('node', [SCRIPT], { encoding: 'utf-8' });
    expect(output).toMatch(/Internal envelopes verified/);
  });
});
