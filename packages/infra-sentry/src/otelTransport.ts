/**
 * Singleton factory for the pino-opentelemetry-transport.
 *
 * Bridges pino logs to Dash0 via OTLP. Returns undefined when
 * INTEXURAOS_DASH0_OTLP_ENDPOINT is not set (tests, no Dash0).
 *
 * Uses OTel-standard env vars (OTEL_EXPORTER_OTLP_LOGS_*) under the hood,
 * mapped from the project-specific INTEXURAOS_DASH0_* vars.
 */

import pino from 'pino';

let cachedTransport: NodeJS.WritableStream | undefined;
let initialized = false;

export function getOtelTransport(): NodeJS.WritableStream | undefined {
  if (initialized) {
    return cachedTransport;
  }

  const endpoint = process.env['INTEXURAOS_DASH0_OTLP_ENDPOINT'];
  if (endpoint === undefined || endpoint === '') {
    initialized = true;
    return undefined;
  }

  // Set OTel-standard env vars for the transport worker thread
  process.env['OTEL_EXPORTER_OTLP_LOGS_ENDPOINT'] = `${endpoint}/v1/logs`;

  /* v8 ignore start -- module-init: cannot test startup path that requires live Dash0 auth token at bootstrap @preserve */
  const authToken = process.env['INTEXURAOS_DASH0_AUTH_TOKEN'] ?? '';
  if (authToken !== '') {
    process.env['OTEL_EXPORTER_OTLP_LOGS_HEADERS'] = `Authorization=Bearer ${authToken}`;
  }
  /* v8 ignore stop @preserve */

  cachedTransport = pino.transport({
    target: 'pino-opentelemetry-transport',
    options: {
      resourceAttributes: {
        'service.name':
          process.env['OTEL_SERVICE_NAME'] ?? process.env['npm_package_name'] ?? 'unknown-service',
        'deployment.environment.name': process.env['INTEXURAOS_ENVIRONMENT'] ?? 'unknown',
      },
    },
  }) as unknown as NodeJS.WritableStream;

  initialized = true;
  return cachedTransport;
}

/** @internal Reset singleton state — for testing only. */
export function _resetOtelTransport(): void {
  cachedTransport = undefined;
  initialized = false;
}
