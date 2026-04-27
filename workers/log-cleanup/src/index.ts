import * as functions from '@google-cloud/functions-framework';
import type { CloudEvent } from '@google-cloud/functions-framework';
import { initWorker } from '@intexuraos/infra-sentry';
import { cleanupOldLogs } from './cleanup.js';
import { extractCorrelation } from './extractCorrelation.js';
import { runWithRequestContext } from './requestContextShim.js';

interface PubSubData {
  message: {
    data?: string;
    attributes?: Record<string, string>;
  };
}

/* v8 ignore start -- module-init: bootstrap initialized at cold start @preserve */
const release = process.env['K_REVISION'] ?? 'unknown';
const sentryDsn = process.env['INTEXURAOS_SENTRY_DSN'];
const { logger: baseLogger, flush } = initWorker({
  serviceName: 'log-cleanup',
  environment: process.env['INTEXURAOS_ENVIRONMENT'] ?? 'development',
  ...(sentryDsn !== undefined ? { sentryDsn } : {}),
  release,
});
const logger = baseLogger.child({ service: 'log-cleanup', release });

process.on('SIGTERM', () => {
  void flush();
});
/* v8 ignore stop @preserve */

async function handleCleanupLogs(event: CloudEvent<PubSubData>): Promise<void> {
  const ctx = extractCorrelation(event.data?.message.attributes);
  await runWithRequestContext(ctx, async () => {
    const reqLogger = logger.child({ requestId: ctx.requestId });
    const traceId = event.id;

    reqLogger.info(
      { traceId, eventType: event.type, source: event.source },
      'Log cleanup triggered by Pub/Sub'
    );

    const result = await cleanupOldLogs(reqLogger);

    if (result.success) {
      reqLogger.info(
        {
          traceId,
          tasksProcessed: result.tasksProcessed,
          logsDeleted: result.logsDeleted,
          durationMs: result.durationMs,
        },
        'Log cleanup completed successfully'
      );
    } else {
      reqLogger.error(
        { traceId, error: result.message, durationMs: result.durationMs },
        'Log cleanup failed'
      );
      throw new Error(result.message);
    }
  });
}

functions.cloudEvent('cleanupLogs', handleCleanupLogs);
