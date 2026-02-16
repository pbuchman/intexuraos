import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { ATTR_DEPLOYMENT_ENVIRONMENT_NAME } from '@opentelemetry/semantic-conventions/incubating';
import { buildOtelConfig } from './config.js';
import { getInstrumentations } from './instrumentations.js';

/* v8 ignore start -- module-init: OTel SDK bootstrap requires live collector for integration testing @preserve */
const config = buildOtelConfig();

if (config !== undefined) {
  const headers: Record<string, string> = {};
  if (config.authToken !== '') {
    headers['Authorization'] = `Bearer ${config.authToken}`;
  }

  const traceExporter = new OTLPTraceExporter({
    url: `${config.endpoint}/v1/traces`,
    headers,
  });

  const metricExporter = new OTLPMetricExporter({
    url: `${config.endpoint}/v1/metrics`,
    headers,
  });

  const logExporter = new OTLPLogExporter({
    url: `${config.endpoint}/v1/logs`,
    headers,
  });

  const sdk = new NodeSDK({
    resource: new Resource({
      [ATTR_SERVICE_NAME]:
        process.env['OTEL_SERVICE_NAME'] ?? process.env['npm_package_name'] ?? 'unknown-service',
      [ATTR_SERVICE_VERSION]: process.env['npm_package_version'] ?? '0.0.0',
      [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: config.environment,
    }),
    traceExporter,
    metricReader: new PeriodicExportingMetricReader({
      exporter: metricExporter,
      exportIntervalMillis: 30_000,
    }),
    logRecordProcessor: new BatchLogRecordProcessor(logExporter),
    instrumentations: getInstrumentations(),
  });

  sdk.start();

  process.on('SIGTERM', () => {
    sdk.shutdown().catch(() => {
      /* best-effort shutdown */
    });
  });
}
/* v8 ignore stop @preserve */
