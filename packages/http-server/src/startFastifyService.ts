/**
 * Shared `main()` scaffold for IntexuraOS Fastify services.
 *
 * Replaces the per-service `index.ts` boilerplate (validate env →
 * initialize Sentry → initialize service container → build server → listen
 * → SIGTERM/SIGINT). The bespoke variants drifted on details (which signals
 * are handled, error logging, exit codes, optional vs required Sentry DSN);
 * this helper standardizes the lifecycle so per-service `index.ts` becomes
 * ~10 lines.
 *
 * Behavior is intentionally identical to the bespoke `main()` in
 * `apps/user-service/src/index.ts` (the pilot reference): env validation
 * happens first, Sentry is initialized with the optional DSN, service
 * dependencies are wired before the server is built, SIGTERM/SIGINT trigger
 * a graceful close.
 */
import type { FastifyInstance } from 'fastify';
import { initSentry } from '@intexuraos/infra-sentry';
import { getErrorMessage } from '@intexuraos/common-core';
import { flushAllUsageSinks } from '@intexuraos/llm-pricing';
import { validateRequiredEnv } from './health.js';

export interface StartFastifyServiceOptions {
  /** Logical service name — used in Sentry tags and startup-failure logs. */
  serviceName: string;
  /** Required environment variables to validate before starting. */
  requiredEnv: readonly string[];
  /** Initialize the per-app service container (DI). May be sync or async. */
  initServices: () => void | Promise<void>;
  /** Build the Fastify server (typically delegates to `createFastifyApp`). */
  buildServer: () => Promise<FastifyInstance>;
  /** Optional override for the listen port — defaults to `PORT` env or 8080. */
  port?: number;
  /** Optional override for the listen host — defaults to `HOST` env or `0.0.0.0`. */
  host?: string;
}

/**
 * Run the standard service lifecycle. Throws if env validation or
 * `app.listen` fails so the calling top-level `await` propagates a non-zero
 * exit. Registers SIGTERM/SIGINT handlers for graceful shutdown.
 */
export async function startFastifyService(opts: StartFastifyServiceOptions): Promise<void> {
  validateRequiredEnv([...opts.requiredEnv]);

  const sentryDsn = process.env['INTEXURAOS_SENTRY_DSN'];
  initSentry({
    ...(sentryDsn !== undefined && sentryDsn !== '' ? { dsn: sentryDsn } : {}),
    environment: process.env['INTEXURAOS_ENVIRONMENT'] ?? 'development',
    serviceName: opts.serviceName,
  });

  await opts.initServices();
  const app = await opts.buildServer();

  const port = opts.port ?? Number(process.env['PORT'] ?? 8080);
  const host = opts.host ?? process.env['HOST'] ?? '0.0.0.0';

  // SIGTERM/SIGINT must drain registered usage sinks BEFORE exit. The HTTP
  // sinks coalesce events on a 500ms unref'd timer; without this drain
  // step, recent events buffered between the last flush and the signal are
  // dropped on Cloud Run scale-down. Drain failures are logged but do not
  // change the exit code — request-lifecycle outcome (`app.close()`) is
  // what determines 0 vs 1.
  const close = (): void => {
    void (async (): Promise<void> => {
      let exitCode = 0;
      try {
        await app.close();
      } catch {
        exitCode = 1;
      }
      try {
        await flushAllUsageSinks({ logger: app.log });
      } catch {
        // flushAllUsageSinks already logs per-sink failures; this catch is
        // belt-and-braces so an unexpected throw never blocks exit.
      }
      process.exit(exitCode);
    })();
  };
  process.on('SIGTERM', close);
  process.on('SIGINT', close);

  try {
    await app.listen({ port, host });
  } catch (error: unknown) {
    process.stderr.write(
      `Failed to start ${opts.serviceName}: ${getErrorMessage(error, String(error))}\n`
    );
    throw error;
  }
}
