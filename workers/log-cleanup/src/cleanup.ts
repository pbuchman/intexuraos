import type { Logger } from './logger.js';

export interface CleanupConfig {
  codeAgentUrl: string;
  internalAuthToken: string;
  retentionDays?: number;
  batchSize?: number;
  tasksPerRun?: number;
}

export interface CleanupResult {
  success: boolean;
  message: string;
  tasksProcessed: number;
  tasksFailed: number;
  logsDeleted: number;
  durationMs: number;
}

interface ApiResponse {
  success: boolean;
  data?: {
    tasksProcessed: number;
    tasksFailed: number;
    logsDeleted: number;
    durationMs: number;
  };
  error?: {
    code: string;
    message: string;
  };
}

export function loadConfig(): CleanupConfig {
  const codeAgentUrl = process.env['INTEXURAOS_CODE_AGENT_URL'];
  const internalAuthToken = process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];

  if (codeAgentUrl === undefined || codeAgentUrl === '') {
    throw new Error('INTEXURAOS_CODE_AGENT_URL is required');
  }

  if (internalAuthToken === undefined || internalAuthToken === '') {
    throw new Error('INTEXURAOS_INTERNAL_AUTH_TOKEN is required');
  }

  const retentionDaysStr = process.env['INTEXURAOS_LOG_RETENTION_DAYS'];
  const batchSizeStr = process.env['INTEXURAOS_LOG_BATCH_SIZE'];
  const tasksPerRunStr = process.env['INTEXURAOS_LOG_TASKS_PER_RUN'];

  const config: CleanupConfig = {
    codeAgentUrl,
    internalAuthToken,
  };

  if (retentionDaysStr !== undefined) {
    config.retentionDays = parseInt(retentionDaysStr, 10);
  }
  if (batchSizeStr !== undefined) {
    config.batchSize = parseInt(batchSizeStr, 10);
  }
  if (tasksPerRunStr !== undefined) {
    config.tasksPerRun = parseInt(tasksPerRunStr, 10);
  }

  return config;
}

export async function cleanupOldLogs(
  logger: Logger,
  config?: CleanupConfig
): Promise<CleanupResult> {
  const startTime = Date.now();
  /* v8 ignore start -- ts-type: config resolution fallback @preserve */
  const resolvedConfig = config ?? loadConfig();
  /* v8 ignore stop @preserve */

  logger.info(
    {
      codeAgentUrl: resolvedConfig.codeAgentUrl,
      retentionDays: resolvedConfig.retentionDays,
      batchSize: resolvedConfig.batchSize,
      tasksPerRun: resolvedConfig.tasksPerRun,
    },
    'Starting log cleanup via code-agent API'
  );

  try {
    const url = `${resolvedConfig.codeAgentUrl}/internal/tasks/cleanup-logs`;
    const body: Record<string, number> = {};

    if (resolvedConfig.retentionDays !== undefined) {
      body['retentionDays'] = resolvedConfig.retentionDays;
    }
    if (resolvedConfig.batchSize !== undefined) {
      body['batchSize'] = resolvedConfig.batchSize;
    }
    if (resolvedConfig.tasksPerRun !== undefined) {
      body['tasksPerRun'] = resolvedConfig.tasksPerRun;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Auth': resolvedConfig.internalAuthToken,
      },
      body: JSON.stringify(body),
    });

    const durationMs = Date.now() - startTime;

    if (!response.ok) {
      const errorText = await response.text();
      logger.error({ statusCode: response.status, errorText, durationMs }, 'API request failed');
      return {
        success: false,
        message: `API returned ${String(response.status)}: ${errorText}`,
        tasksProcessed: 0,
        tasksFailed: 0,
        logsDeleted: 0,
        durationMs,
      };
    }

    const apiResponse = (await response.json()) as ApiResponse;

    if (!apiResponse.success) {
      logger.error({ error: apiResponse.error, durationMs }, 'API returned error response');
      return {
        success: false,
        message: apiResponse.error?.message ?? 'Unknown API error',
        tasksProcessed: 0,
        tasksFailed: 0,
        logsDeleted: 0,
        durationMs,
      };
    }

    const data = apiResponse.data;
    if (data === undefined) {
      return {
        success: false,
        message: 'API returned success but no data',
        tasksProcessed: 0,
        tasksFailed: 0,
        logsDeleted: 0,
        durationMs,
      };
    }

    logger.info(
      {
        tasksProcessed: data.tasksProcessed,
        tasksFailed: data.tasksFailed,
        logsDeleted: data.logsDeleted,
        durationMs: data.durationMs,
      },
      'Log cleanup completed successfully'
    );

    return {
      success: true,
      message: `Processed ${String(data.tasksProcessed)} tasks, deleted ${String(data.logsDeleted)} logs`,
      tasksProcessed: data.tasksProcessed,
      tasksFailed: data.tasksFailed,
      logsDeleted: data.logsDeleted,
      durationMs: data.durationMs,
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    logger.error({ error: errorMessage, durationMs }, 'Log cleanup failed');

    return {
      success: false,
      message: errorMessage,
      tasksProcessed: 0,
      tasksFailed: 0,
      logsDeleted: 0,
      durationMs,
    };
  }
}
