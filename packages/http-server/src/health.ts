/**
 * Health check utilities for IntexuraOS services.
 *
 * Two complementary models live here:
 *
 *  1. The legacy data shape — `HealthCheckResult`, `buildHealthResponse`,
 *     `checkSecrets`, `computeOverallStatus`. Useful for services that
 *     want to assemble the `/health` payload by hand.
 *
 *  2. The new functional shape — `HealthCheck`, `registerHealthCheck`.
 *     Services pass a list of named async probes; the plugin registers
 *     `GET /health`, runs them, measures latency, and emits the standard
 *     `HealthResponse`. This is the preferred API for new code.
 *
 * The package no longer carries Firestore or Notion-specific probes.
 * Firestore probes live in `@intexuraos/infra-firestore`; Notion probes
 * are owned by `apps/notion-service`. This breaks the previous coupling
 * from `@intexuraos/http-server` → `@intexuraos/infra-firestore`.
 */

import type { FastifyInstance } from 'fastify';
import { getErrorMessage } from '@intexuraos/common-core';

/**
 * Health status values.
 */
export type HealthStatus = 'ok' | 'degraded' | 'down';

/**
 * Individual health check result (data shape).
 *
 * Returned by lower-level helpers like `checkSecrets`, by the new
 * `registerHealthCheck` plugin (after running each probe), and by ad-hoc
 * helpers that services own (e.g. `firestoreHealthCheck` from
 * `@intexuraos/infra-firestore`).
 */
export interface HealthCheckResult {
  name: string;
  status: HealthStatus;
  latencyMs: number;
  details: Record<string, unknown> | null;
}

/**
 * Functional probe used with `registerHealthCheck`.
 *
 * Each probe declares a name and an async `check()` that returns a
 * minimal ok/down outcome. The registration plugin measures latency
 * around the probe and converts the outcome into a `HealthCheckResult`.
 */
export interface HealthCheck {
  name: string;
  check: () => Promise<{ ok: true } | { ok: false; detail?: string }>;
}

/**
 * Health check response structure.
 */
export interface HealthResponse {
  status: HealthStatus;
  serviceName: string;
  version: string;
  timestamp: string;
  checks: HealthCheckResult[];
}

/**
 * Check required environment variables.
 * Returns a health check result indicating if all required secrets are present.
 */
export function checkSecrets(required: string[]): HealthCheckResult {
  const start = Date.now();
  const missing = findMissingSecrets(required);

  return {
    name: 'secrets',
    status: missing.length === 0 ? 'ok' : 'down',
    latencyMs: Date.now() - start,
    details: missing.length > 0 ? { missing } : null,
  };
}

/**
 * Compute the list of required env vars that are unset/empty.
 * Shared by `checkSecrets` (data-shape) and `secretsHealthCheck`
 * (functional) so the two stay in lock-step.
 */
function findMissingSecrets(required: string[]): string[] {
  return required.filter((k) => process.env[k] === undefined || process.env[k] === '');
}

/**
 * Functional adapter around the same env-var probe used by
 * `checkSecrets`, for use with `registerHealthCheck`.
 *
 * Reports the missing variable names in `detail` when one or more are
 * absent so operators can act on the `/health` payload directly.
 *
 * Wire-shape note: the legacy `checkSecrets` exposed `details: { missing:
 * string[] }`. The new functional `HealthCheck` contract restricts
 * failure detail to a single string, so we serialize the list as
 * `"missing: VAR_A, VAR_B"`. Operators that consumed the structured
 * array must split on `, ` after the `missing: ` prefix.
 */
export function secretsHealthCheck(required: string[]): HealthCheck {
  return {
    name: 'secrets',
    check: (): Promise<{ ok: true } | { ok: false; detail?: string }> => {
      const missing = findMissingSecrets(required);
      if (missing.length === 0) {
        return Promise.resolve({ ok: true });
      }
      return Promise.resolve({ ok: false, detail: `missing: ${missing.join(', ')}` });
    },
  };
}

/**
 * Validate required environment variables at startup.
 * Throws if any required variables are missing or empty.
 * Call this before buildServer() in index.ts to fail fast.
 */
export function validateRequiredEnv(required: string[]): void {
  const missing = required.filter((k) => process.env[k] === undefined || process.env[k] === '');
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}\n` +
        `Ensure these are set in Terraform env_vars or .envrc.local for local development.`
    );
  }
}

/**
 * Compute overall health status from individual checks.
 */
export function computeOverallStatus(checks: HealthCheckResult[]): HealthStatus {
  if (checks.some((c) => c.status === 'down')) return 'down';
  if (checks.some((c) => c.status === 'degraded')) return 'degraded';
  return 'ok';
}

/**
 * Build a complete health response.
 */
export function buildHealthResponse(
  serviceName: string,
  version: string,
  checks: HealthCheckResult[]
): HealthResponse {
  return {
    status: computeOverallStatus(checks),
    serviceName,
    version,
    timestamp: new Date().toISOString(),
    checks,
  };
}

/**
 * Run a single functional `HealthCheck` and convert it to the
 * `HealthCheckResult` data shape, measuring latency and trapping
 * synchronous + asynchronous errors so one failed probe cannot crash
 * the `/health` response.
 */
async function runHealthCheck(check: HealthCheck): Promise<HealthCheckResult> {
  const start = Date.now();
  try {
    const outcome = await check.check();
    if (outcome.ok) {
      return {
        name: check.name,
        status: 'ok',
        latencyMs: Date.now() - start,
        details: null,
      };
    }
    return {
      name: check.name,
      status: 'down',
      latencyMs: Date.now() - start,
      details: outcome.detail !== undefined ? { detail: outcome.detail } : null,
    };
  } catch (error) {
    return {
      name: check.name,
      status: 'down',
      latencyMs: Date.now() - start,
      details: { error: getErrorMessage(error) },
    };
  }
}

/**
 * Options accepted by `registerHealthCheck`.
 *
 * `serviceName` and `version` populate the standard `/health` response
 * envelope. `checks` is the explicit list of probes the plugin runs on
 * every request — passing an empty array is allowed (the response will
 * report `status: 'ok'` with no individual checks).
 */
export interface RegisterHealthCheckOptions {
  serviceName: string;
  version: string;
  checks: HealthCheck[];
}

/**
 * Register the standard `GET /health` endpoint on a Fastify instance.
 *
 * On every request the plugin:
 *  - runs every probe in `opts.checks` (in parallel),
 *  - converts each outcome to a `HealthCheckResult` (with measured latency),
 *  - emits the standard `HealthResponse` envelope (raw, NOT wrapped in
 *    `apiOk`/`apiFail` — see api-contracts.md),
 *  - sets the `x-health-duration-ms` response header for observability.
 *
 * Schema is registered on the route so the response shows up in the
 * service's OpenAPI document.
 */
export async function registerHealthCheck(
  fastify: FastifyInstance,
  opts: RegisterHealthCheckOptions
): Promise<void> {
  const { serviceName, version, checks } = opts;

  fastify.get(
    '/health',
    {
      schema: {
        operationId: 'getHealth',
        summary: 'Health check',
        description: 'Health check endpoint',
        tags: ['system'],
        response: {
          200: {
            description: 'Service health status',
            type: 'object',
            required: ['status', 'serviceName', 'version', 'timestamp', 'checks'],
            properties: {
              status: { type: 'string', enum: ['ok', 'degraded', 'down'] },
              serviceName: { type: 'string' },
              version: { type: 'string' },
              timestamp: { type: 'string', format: 'date-time' },
              checks: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['name', 'status', 'latencyMs'],
                  properties: {
                    name: { type: 'string' },
                    status: { type: 'string', enum: ['ok', 'degraded', 'down'] },
                    latencyMs: { type: 'number' },
                    details: { type: 'object', nullable: true, additionalProperties: true },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (_req, reply) => {
      const started = Date.now();
      const results = await Promise.all(checks.map((c) => runHealthCheck(c)));
      const response = buildHealthResponse(serviceName, version, results);

      void reply.header('x-health-duration-ms', String(Date.now() - started));
      return await reply.type('application/json').send(response);
    }
  );

  await Promise.resolve();
}
