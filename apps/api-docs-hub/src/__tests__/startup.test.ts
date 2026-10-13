import { spawn, spawnSync } from 'node:child_process';
import { createConnection, createServer } from 'node:net';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { OPEN_API_SOURCE_CATALOG } from '../config.js';

const repoRoot = resolve(import.meta.dirname, '../../../..');
const entrypoint = resolve(import.meta.dirname, '../index.ts');
const basicExcluded = new Set(['message-digest-service', 'research-agent']);
const children = new Set<ReturnType<typeof spawn>>();

function startupEnv(options: { profile: 'basic' | 'full'; missing?: string }): NodeJS.ProcessEnv {
  const openApiKeys = new Set<string>(
    OPEN_API_SOURCE_CATALOG.map((entry) => entry.openApiUrlEnvVar)
  );
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => key !== 'INTEXURAOS_API_DOCS_EXPECTED_SERVICES' && !openApiKeys.has(key)
    )
  );
  const activeCatalog = OPEN_API_SOURCE_CATALOG.filter(
    (entry) => options.profile === 'full' || !basicExcluded.has(entry.service)
  );

  if (options.profile === 'basic') {
    env['INTEXURAOS_API_DOCS_EXPECTED_SERVICES'] = activeCatalog
      .map((entry) => entry.service)
      .join(',');
  }
  for (const entry of activeCatalog) {
    if (entry.openApiUrlEnvVar !== options.missing) {
      env[entry.openApiUrlEnvVar] = `http://127.0.0.1:1/${entry.service}/openapi.json`;
    }
  }
  env['PORT'] = '0';
  env['HOST'] = '127.0.0.1';
  env['NODE_ENV'] = 'production';
  env['INTEXURAOS_ENVIRONMENT'] = 'test';
  return env;
}

async function availablePort(): Promise<number> {
  return await new Promise<number>((resolvePromise, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close();
        reject(new Error('Failed to reserve a local startup-test port'));
        return;
      }
      server.close((error) => {
        if (error !== undefined) {
          reject(error);
          return;
        }
        resolvePromise(address.port);
      });
    });
  });
}

async function expectStartup(env: NodeJS.ProcessEnv, port: number): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', entrypoint], {
      cwd: repoRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.add(child);
    let output = '';
    let settled = false;
    let probe: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      settled = true;
      child.kill('SIGKILL');
      reject(new Error(`API Docs Hub did not start:\n${output}`));
    }, 5_000);

    const probePort = (): void => {
      const socket = createConnection({ host: '127.0.0.1', port });
      socket.once('connect', () => {
        socket.destroy();
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.kill('SIGTERM');
        resolvePromise();
      });
      socket.once('error', () => {
        socket.destroy();
        if (!settled) probe = setTimeout(probePort, 50);
      });
    };
    const inspect = (chunk: Buffer): void => {
      output += chunk.toString();
    };
    child.stdout.on('data', inspect);
    child.stderr.on('data', inspect);
    child.once('exit', (code, signal) => {
      children.delete(child);
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        if (probe !== undefined) clearTimeout(probe);
        reject(new Error(`API Docs Hub exited before startup (${String(code)}/${String(signal)}):\n${output}`));
      }
    });
    probePort();
  });
}

afterEach(() => {
  for (const child of children) {
    child.kill('SIGKILL');
  }
  children.clear();
});

describe('API Docs Hub startup boundary', () => {
  it('starts the basic profile without URLs for excluded services', async () => {
    const port = await availablePort();
    const env = startupEnv({ profile: 'basic' });
    env['PORT'] = String(port);
    await expectStartup(env, port);
  });

  it('still fails basic startup when an enabled service URL is missing', () => {
    const missing = 'INTEXURAOS_USER_SERVICE_OPENAPI_URL';
    const result = spawnSync(process.execPath, ['--import', 'tsx', entrypoint], {
      cwd: repoRoot,
      env: startupEnv({ profile: 'basic', missing }),
      encoding: 'utf8',
      timeout: 10_000,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(missing);
    expect(result.stderr).not.toContain('INTEXURAOS_MESSAGE_DIGEST_SERVICE_OPENAPI_URL');
    expect(result.stderr).not.toContain('INTEXURAOS_RESEARCH_AGENT_OPENAPI_URL');
  });

  it('keeps the default full profile fail-closed', () => {
    const missing = 'INTEXURAOS_MESSAGE_DIGEST_SERVICE_OPENAPI_URL';
    const result = spawnSync(process.execPath, ['--import', 'tsx', entrypoint], {
      cwd: repoRoot,
      env: startupEnv({ profile: 'full', missing }),
      encoding: 'utf8',
      timeout: 10_000,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(missing);
  });
});
