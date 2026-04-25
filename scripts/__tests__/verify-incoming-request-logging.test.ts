/**
 * Tests for `scripts/verify-incoming-request-logging.mjs`.
 *
 * Spawns the script with `--root <tmpDir>` and asserts exit code/stdout
 * for compliant and non-compliant fixture trees.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { maskNonCode } from '../verify-incoming-request-logging.mjs';

const SCRIPT = resolve(import.meta.dirname, '..', 'verify-incoming-request-logging.mjs');

function runScript(rootDir) {
  const res = spawnSync('node', [SCRIPT, '--root', rootDir], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return { code: res.status ?? -1, stdout: res.stdout, stderr: res.stderr };
}

function makeRouteFile(rootDir, appName, fileName, contents) {
  const dir = join(rootDir, 'apps', appName, 'src', 'routes');
  mkdirSync(dir, { recursive: true });
  const subdirs = fileName.split('/').slice(0, -1);
  if (subdirs.length > 0) {
    mkdirSync(join(dir, ...subdirs), { recursive: true });
  }
  const full = join(dir, fileName);
  writeFileSync(full, contents);
  return full;
}

let tmpRoot;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'verify-irl-'));
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('verify-incoming-request-logging', () => {
  it('exits 0 when every route handler calls logIncomingRequest', () => {
    makeRouteFile(
      tmpRoot,
      'svc',
      'ok.ts',
      `
import { logIncomingRequest } from '@intexuraos/common-http';

export const ok = (fastify) => {
  fastify.post('/ping', async (request, reply) => {
    logIncomingRequest(request, { message: 'POST /ping' });
    return reply.ok({});
  });

  fastify.get<{ Params: { id: string } }>('/things/:id', async (request, reply) => {
    logIncomingRequest(request, { message: 'GET /things/:id' });
    return reply.ok({});
  });
};
`
    );

    const { code, stdout } = runScript(tmpRoot);
    expect(code).toBe(0);
    expect(stdout).toContain('Incoming request logging verified');
  });

  it('exits 1 when a route handler is missing logIncomingRequest', () => {
    makeRouteFile(
      tmpRoot,
      'svc',
      'bad.ts',
      `
export const bad = (fastify) => {
  fastify.post('/missing', async (request, reply) => {
    return reply.ok({});
  });
};
`
    );

    const { code, stdout } = runScript(tmpRoot);
    expect(code).toBe(1);
    expect(stdout).toContain('bad.ts');
    expect(stdout).toContain('fastify.post');
    expect(stdout).toContain('missing logIncomingRequest');
  });

  it('handles TypeScript generic args on routes without false positives', () => {
    makeRouteFile(
      tmpRoot,
      'svc',
      'gen.ts',
      `
import { logIncomingRequest } from '@intexuraos/common-http';

export const gen = (fastify) => {
  fastify.post<{ Body: { x: number } }>('/g', async (request, reply) => {
    logIncomingRequest(request, { message: 'POST /g' });
    return reply.ok({});
  });
};
`
    );

    const { code } = runScript(tmpRoot);
    expect(code).toBe(0);
  });

  it('detects multiple violations in a single file', () => {
    makeRouteFile(
      tmpRoot,
      'svc',
      'multi.ts',
      `
import { logIncomingRequest } from '@intexuraos/common-http';

export const multi = (fastify) => {
  fastify.post('/a', async (request, reply) => {
    return reply.ok({});
  });

  fastify.get('/b', async (request, reply) => {
    logIncomingRequest(request, { message: 'GET /b' });
    return reply.ok({});
  });

  fastify.delete('/c', async (request, reply) => {
    return reply.ok({});
  });
};
`
    );

    const { code, stdout } = runScript(tmpRoot);
    expect(code).toBe(1);
    expect(stdout).toMatch(/multi\.ts:.*fastify\.post/);
    expect(stdout).toMatch(/multi\.ts:.*fastify\.delete/);
    expect(stdout).not.toMatch(/multi\.ts:.*fastify\.get/);
  });

  it('ignores comment-shaped fastify.get inside line comments', () => {
    makeRouteFile(
      tmpRoot,
      'svc',
      'comments.ts',
      `
import { logIncomingRequest } from '@intexuraos/common-http';

export const c = (fastify) => {
  // fastify.get('/ghost', async () => {});  // <- this is a comment, must be ignored
  /* fastify.post('/also-ghost', async () => {}); */
  fastify.get('/real', async (request, reply) => {
    logIncomingRequest(request, { message: 'GET /real' });
    return reply.ok({});
  });
};
`
    );

    const { code } = runScript(tmpRoot);
    expect(code).toBe(0);
  });

  it('ignores fastify.post inside string literals', () => {
    makeRouteFile(
      tmpRoot,
      'svc',
      'strings.ts',
      `
import { logIncomingRequest } from '@intexuraos/common-http';

export const s = (fastify) => {
  const sample = "fastify.post('/inside', async () => {})";
  const sample2 = 'fastify.get(\\'/x\\', () => {})';
  fastify.post('/real', async (request, reply) => {
    logIncomingRequest(request, { message: 'POST /real' });
    void sample;
    void sample2;
    return reply.ok({});
  });
};
`
    );

    const { code } = runScript(tmpRoot);
    expect(code).toBe(0);
  });

  it('handles template literals with ${...} substitutions and braces in strings', () => {
    makeRouteFile(
      tmpRoot,
      'svc',
      'tpl.ts',
      `
import { logIncomingRequest } from '@intexuraos/common-http';

export const t = (fastify) => {
  const x = 1;
  const tag = \`prefix \${x + 2} { suffix }\`;
  const json = "{ \\"a\\": 1 }";
  fastify.post('/real', async (request, reply) => {
    logIncomingRequest(request, { message: 'POST /real' });
    void tag;
    void json;
    return reply.ok({});
  });
};
`
    );

    const { code } = runScript(tmpRoot);
    expect(code).toBe(0);
  });

  it('exempts index.ts, schemas.ts, types.ts and __tests__ paths', () => {
    // Each of these files would be flagged if the verifier read them.
    makeRouteFile(
      tmpRoot,
      'svc',
      'index.ts',
      `
export const index = (fastify) => {
  fastify.get('/no-log', async (request, reply) => {
    return reply.ok({});
  });
};
`
    );
    makeRouteFile(
      tmpRoot,
      'svc',
      'types.ts',
      `
export const types = (fastify) => {
  fastify.post('/no-log', async (request, reply) => {
    return reply.ok({});
  });
};
`
    );
    makeRouteFile(
      tmpRoot,
      'svc',
      'schemas.ts',
      `
export const schemas = (fastify) => {
  fastify.delete('/no-log', async (request, reply) => {
    return reply.ok({});
  });
};
`
    );
    makeRouteFile(
      tmpRoot,
      'svc',
      '__tests__/route.test.ts',
      `
export const test = (fastify) => {
  fastify.post('/no-log', async (request, reply) => {
    return reply.ok({});
  });
};
`
    );
    makeRouteFile(
      tmpRoot,
      'svc',
      'helpers/util.ts',
      `
export const util = (fastify) => {
  fastify.post('/no-log', async (request, reply) => {
    return reply.ok({});
  });
};
`
    );

    const { code } = runScript(tmpRoot);
    expect(code).toBe(0);
  });

  it('does not match a function called fastify_get (similar identifier)', () => {
    makeRouteFile(
      tmpRoot,
      'svc',
      'helper.ts',
      `
export function fastify_get(name) {
  return name;
}
export const r = (fastify) => {
  fastify.post('/r', async (request, reply) => {
    void fastify_get('x');
    return reply.ok({});
  });
};
`
    );

    const { code, stdout } = runScript(tmpRoot);
    expect(code).toBe(1);
    expect(stdout).toMatch(/helper\.ts:.*fastify\.post/);
    // Must NOT report fastify.get from the function name
    expect(stdout).not.toMatch(/fastify\.get/);
  });
});

describe('maskNonCode helper', () => {
  it('masks single-line comments preserving newlines', () => {
    const masked = maskNonCode('a // hidden\nb');
    expect(masked).toBe('a          \nb');
  });

  it('masks block comments preserving length', () => {
    const masked = maskNonCode('a/* x */b');
    expect(masked).toBe('a       b');
  });

  it('masks string contents but keeps delimiters', () => {
    const masked = maskNonCode("a 'hi' b");
    expect(masked).toBe("a '  ' b");
  });

  it('masks template literal contents but keeps delimiters', () => {
    const masked = maskNonCode('a `hi`b');
    expect(masked).toBe('a `  `b');
  });

  it('descends into ${...} substitutions inside templates', () => {
    const src = 'a `pre ${x} post` end';
    const masked = maskNonCode(src);
    // Substitution body 'x' is code, surrounding tpl chars masked
    expect(masked.includes('${x}')).toBe(true);
  });
});
