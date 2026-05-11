import { trace } from '@opentelemetry/api';

interface ProviderWithDelegate {
  getDelegate?: () => unknown;
}

export interface AssertOtelActiveOptions {
  serviceName: string;
  environment?: string;
  tracerProvider?: unknown;
}

function constructorName(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return '';
  }
  return value.constructor.name;
}

export function isNoopTracerProvider(provider: unknown): boolean {
  if (constructorName(provider) === 'NoopTracerProvider') {
    return true;
  }

  if (provider === null || typeof provider !== 'object') {
    return false;
  }

  const maybeDelegate = provider as ProviderWithDelegate;
  if (typeof maybeDelegate.getDelegate !== 'function') {
    return false;
  }

  return constructorName(maybeDelegate.getDelegate()) === 'NoopTracerProvider';
}

export function assertOtelActive(options: AssertOtelActiveOptions): void {
  const environment = options.environment ?? process.env['INTEXURAOS_ENVIRONMENT'] ?? 'unknown';
  if (environment !== 'prod') {
    return;
  }

  const provider = options.tracerProvider ?? trace.getTracerProvider();
  if (!isNoopTracerProvider(provider)) {
    return;
  }

  throw new Error(
    `OpenTelemetry is not active for ${options.serviceName}; ensure @intexuraos/infra-otel/register is preloaded before service bootstrap`
  );
}
