/**
 * Tests for the shared service lifecycle scaffold.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { startFastifyService } from '../startFastifyService.js';

vi.mock('@intexuraos/infra-sentry', () => ({
  initSentry: vi.fn(),
}));

const fakeApp = (): FastifyInstance => {
  const app = {
    listen: vi.fn(async (): Promise<void> => undefined),
    close: vi.fn(async (): Promise<void> => undefined),
  };
  return app as unknown as FastifyInstance;
};

describe('startFastifyService', () => {
  const originalEnv = { ...process.env };
  const handlersToCleanUp: { event: 'SIGTERM' | 'SIGINT'; listener: NodeJS.SignalsListener }[] = [];

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
    while (handlersToCleanUp.length > 0) {
      const entry = handlersToCleanUp.pop();
      if (entry !== undefined) {
        process.off(entry.event, entry.listener);
      }
    }
  });

  it('validates required env before starting', async () => {
    delete process.env['REQ_ENV_VAR'];
    await expect(
      startFastifyService({
        serviceName: 'x',
        requiredEnv: ['REQ_ENV_VAR'],
        initServices: () => undefined,
        buildServer: async () => fakeApp(),
      })
    ).rejects.toThrow(/Missing required environment variables: REQ_ENV_VAR/);
  });

  it('runs initServices, buildServer, and listen in order', async () => {
    process.env['REQ_ENV_VAR'] = 'x';
    const order: string[] = [];
    const app = fakeApp();
    (app.listen as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (): Promise<void> => {
        order.push('listen');
      }
    );

    await startFastifyService({
      serviceName: 'x',
      requiredEnv: ['REQ_ENV_VAR'],
      initServices: () => {
        order.push('initServices');
      },
      buildServer: async () => {
        order.push('buildServer');
        return app;
      },
      port: 0,
      host: '127.0.0.1',
    });

    expect(order).toEqual(['initServices', 'buildServer', 'listen']);
    expect(app.listen).toHaveBeenCalledWith({ port: 0, host: '127.0.0.1' });
  });

  it('awaits async initServices', async () => {
    process.env['REQ_ENV_VAR'] = 'x';
    let initCompleted = false;
    const app = fakeApp();

    await startFastifyService({
      serviceName: 'x',
      requiredEnv: ['REQ_ENV_VAR'],
      initServices: async () => {
        await new Promise((r) => setTimeout(r, 1));
        initCompleted = true;
      },
      buildServer: async () => {
        expect(initCompleted).toBe(true);
        return app;
      },
      port: 0,
      host: '127.0.0.1',
    });
  });

  it('rethrows when listen fails', async () => {
    process.env['REQ_ENV_VAR'] = 'x';
    const app = fakeApp();
    (app.listen as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'));
    // Silence the diagnostic process.stderr.write in the failure path so
    // test-stdout validation does not flag it as unexpected output.
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await expect(
      startFastifyService({
        serviceName: 'x',
        requiredEnv: ['REQ_ENV_VAR'],
        initServices: () => undefined,
        buildServer: async () => app,
        port: 0,
        host: '127.0.0.1',
      })
    ).rejects.toThrow('boom');

    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to start x'));
    stderrSpy.mockRestore();
  });

  it('falls back to PORT env when port is not provided', async () => {
    process.env['REQ_ENV_VAR'] = 'x';
    process.env['PORT'] = '12345';
    process.env['HOST'] = '127.0.0.99';
    const app = fakeApp();

    await startFastifyService({
      serviceName: 'x',
      requiredEnv: ['REQ_ENV_VAR'],
      initServices: () => undefined,
      buildServer: async () => app,
    });

    expect(app.listen).toHaveBeenCalledWith({ port: 12345, host: '127.0.0.99' });
  });

  it('uses defaults (8080, 0.0.0.0) when PORT/HOST are unset', async () => {
    process.env['REQ_ENV_VAR'] = 'x';
    delete process.env['PORT'];
    delete process.env['HOST'];
    const app = fakeApp();

    await startFastifyService({
      serviceName: 'x',
      requiredEnv: ['REQ_ENV_VAR'],
      initServices: () => undefined,
      buildServer: async () => app,
    });

    expect(app.listen).toHaveBeenCalledWith({ port: 8080, host: '0.0.0.0' });
  });

  it('passes the Sentry DSN to initSentry when configured', async () => {
    process.env['REQ_ENV_VAR'] = 'x';
    process.env['INTEXURAOS_SENTRY_DSN'] = 'https://example@sentry.io/1';
    const { initSentry } = await import('@intexuraos/infra-sentry');
    const app = fakeApp();
    await startFastifyService({
      serviceName: 'x',
      requiredEnv: ['REQ_ENV_VAR'],
      initServices: () => undefined,
      buildServer: async () => app,
      port: 0,
    });
    expect(initSentry).toHaveBeenCalledWith(
      expect.objectContaining({ dsn: 'https://example@sentry.io/1' })
    );
  });

  it('omits the dsn key when INTEXURAOS_SENTRY_DSN is empty', async () => {
    process.env['REQ_ENV_VAR'] = 'x';
    process.env['INTEXURAOS_SENTRY_DSN'] = '';
    const { initSentry } = await import('@intexuraos/infra-sentry');
    const app = fakeApp();
    await startFastifyService({
      serviceName: 'x',
      requiredEnv: ['REQ_ENV_VAR'],
      initServices: () => undefined,
      buildServer: async () => app,
      port: 0,
    });
    const call = (initSentry as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      | Record<string, unknown>
      | undefined;
    expect(call).toBeDefined();
    expect(call).not.toHaveProperty('dsn');
  });

  it('registers SIGTERM and SIGINT handlers', async () => {
    process.env['REQ_ENV_VAR'] = 'x';
    const before = {
      sigterm: process.listenerCount('SIGTERM'),
      sigint: process.listenerCount('SIGINT'),
    };
    const app = fakeApp();
    await startFastifyService({
      serviceName: 'x',
      requiredEnv: ['REQ_ENV_VAR'],
      initServices: () => undefined,
      buildServer: async () => app,
      port: 0,
    });
    expect(process.listenerCount('SIGTERM')).toBeGreaterThanOrEqual(before.sigterm + 1);
    expect(process.listenerCount('SIGINT')).toBeGreaterThanOrEqual(before.sigint + 1);
    // Note: handlers call process.exit; we cannot invoke them here. They are
    // covered by integration tests at the per-app level.
  });
});
