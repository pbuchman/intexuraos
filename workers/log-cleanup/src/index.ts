import * as functions from '@google-cloud/functions-framework';
import type { CloudEvent } from '@google-cloud/functions-framework';
import { logger } from './logger.js';
import { cleanupOldLogs } from './cleanup.js';

interface PubSubData {
  message: {
    data?: string;
    attributes?: Record<string, string>;
  };
}

async function handleCleanupLogs(event: CloudEvent<PubSubData>): Promise<void> {
  const traceId = event.id;

  logger.info(
    { traceId, eventType: event.type, source: event.source },
    'Log cleanup triggered by Pub/Sub'
  );

  const result = await cleanupOldLogs();

  if (result.success) {
    logger.info(
      {
        traceId,
        tasksProcessed: result.tasksProcessed,
        logsDeleted: result.logsDeleted,
        durationMs: result.durationMs,
      },
      'Log cleanup completed successfully'
    );
  } else {
    logger.error(
      { traceId, error: result.message, durationMs: result.durationMs },
      'Log cleanup failed'
    );
    throw new Error(result.message);
  }
}

functions.cloudEvent('cleanupLogs', handleCleanupLogs);
