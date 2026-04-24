import { type Logger, getErrorMessage } from '@intexuraos/common-core';
import type { OrchestratorConfig } from '../../types/config.js';
import type { Task, TaskResult } from '../../types/task.js';
import type { TurnMetricsCollector } from '../turn-metrics-collector.js';
import type {
  AgentComplianceValidator,
  ComplianceValidationInput,
} from '../agent-compliance-validator.js';
import type { CompletionVerifierVerdict } from '../completion-verifier.js';
import type { WebhookClient } from '../webhook-client.js';
import type { LogForwarder } from '../log-forwarder.js';
import { readSessionTranscript } from '../transcript-reader.js';
import { formatTranscript } from '../transcript-formatter.js';
import { extractPrNumber } from '../deep-validator-helpers.js';
import { appendOrchestratorTaskLog } from './log-streaming.js';

/**
 * Publishes per-attempt turn metrics for a task. Non-fatal on failure —
 * finalize must continue even if the metrics pipeline is down.
 */
export async function collectTurnMetrics(
  turnMetricsCollector: TurnMetricsCollector | undefined, // @allow-undefined-type -- function parameter, not optional property
  logger: Logger,
  task: Task,
  attempt: number
): Promise<void> {
  if (turnMetricsCollector === undefined) return;
  try {
    await turnMetricsCollector.collectAndPublish({
      taskId: task.taskId,
      containerId: task.containerId,
      attempt,
      startedAt: task.startedAt,
      completedAt: new Date().toISOString(),
    });
  } catch (error) {
    logger.error(
      { taskId: task.taskId, attempt, error },
      'Failed to collect turn metrics (non-fatal, task finalization continues)'
    );
  }
}

/**
 * Gathers the inputs required to run compliance validation for an execution
 * task. Returns `undefined` when the validator is not configured, the task is
 * not an execution agent, the PR number is unavailable, or the transcript is
 * empty. Called *before* teardown so the worktree transcript is still readable.
 */
function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function arrayOrStringToCsv(value: unknown): string {
  if (Array.isArray(value)) return value.map((v) => (typeof v === 'string' ? v : String(v))).join(',');
  return asString(value);
}

function asOutcome(value: unknown): 'implemented' | 'already_completed' | 'failed' {
  if (value === 'implemented' || value === 'already_completed' || value === 'failed') return value;
  return 'implemented';
}

function asUsedNotUsed(value: unknown): 'used' | 'not used' {
  if (value === true || value === '1') return 'used';
  return 'not used';
}

/**
 * [INT-1470] Post-verifier-LLM: `verification.data` is a Record<string, unknown>
 * from the deterministic block parser. Task type is routed on the presence of
 * the `pr` field + absence of planning/review-specific keys; for execution
 * compliance we also check that the agent is actually an execution agent
 * via `task.agentType`.
 */
export async function prepareComplianceValidationInput(
  agentComplianceValidator: AgentComplianceValidator | undefined, // @allow-undefined-type -- function parameter, not optional property
  config: OrchestratorConfig,
  logForwarder: LogForwarder,
  logger: Logger,
  task: Task,
  finalResult: TaskResult,
  verification: CompletionVerifierVerdict
): Promise<ComplianceValidationInput | undefined> {
  if (agentComplianceValidator === undefined) return undefined;
  if (verification.kind !== 'parsed') return undefined;
  if (task.agentType !== 'execution') return undefined;

  try {
    const data = verification.data;

    const prNumber = extractPrNumber(finalResult.prUrl);
    if (prNumber === undefined) {
      logger.warn({ taskId: task.taskId }, 'Compliance validation skipped: no PR number');
      return undefined;
    }

    appendOrchestratorTaskLog(logForwarder, task.taskId, 'Starting compliance validation');

    const entries = await readSessionTranscript(config.secretsBasePath, task.taskId, logger);

    if (entries.length === 0) {
      logger.warn({ taskId: task.taskId }, 'Compliance validation skipped: no transcript entries');
      return undefined;
    }

    const formattedTranscript = formatTranscript(entries);

    return {
      taskId: task.taskId,
      prNumber,
      repository: task.repository,
      formattedTranscript,
      agentClaims: {
        outcome: asOutcome(data['outcome']),
        superpowers_subagent_driven_dev: asUsedNotUsed(data['superpowers_subagent_driven_dev_used']),
        superpowers_requesting_code_review: asUsedNotUsed(
          data['superpowers_requesting_code_review_used']
        ),
        gh_pr_url: asString(data['pr']),
        failure_reason: asString(data['failure_reason']),
        memory_ids_used: arrayOrStringToCsv(data['memory_ids_used']),
        memory_ids_rejected: arrayOrStringToCsv(data['memory_ids_rejected']),
        memory_usage_summary: asString(data['memory_usage_summary']),
        summary: asString(data['summary']),
      },
      workerType: task.workerType,
    };
  } catch (error) {
    logger.warn(
      { taskId: task.taskId, error: getErrorMessage(error) },
      'Compliance validation preparation failed (non-fatal, skipping compliance validation)'
    );
    return undefined;
  }
}

/**
 * Runs the compliance validator in the background and forwards the resulting
 * structured report to code-agent via the /internal/webhooks/compliance-report
 * endpoint. Swallows all errors — the task has already been finalized.
 */
export async function executeComplianceValidation(
  agentComplianceValidator: AgentComplianceValidator | undefined, // @allow-undefined-type -- function parameter, not optional property
  webhookClient: WebhookClient,
  logForwarder: LogForwarder,
  logger: Logger,
  task: Task,
  input: ComplianceValidationInput
): Promise<void> {
  const { taskId } = task;
  appendOrchestratorTaskLog(
    logForwarder,
    taskId,
    `Compliance validation starting (transcript: ${String(input.formattedTranscript.length)} chars)`
  );
  try {
    const result = await agentComplianceValidator?.validate(input, (message: string) => {
      appendOrchestratorTaskLog(logForwarder, taskId, `Compliance validation: ${message}`);
    });
    if (result !== undefined && result !== null) {
      appendOrchestratorTaskLog(logForwarder, taskId, 'Compliance validation completed');
      logger.info({ taskId }, 'Compliance validation completed');

      // Fire-and-forget: send structured report to code-agent
      const complianceReportUrl = task.webhookUrl.replace(
        '/internal/webhooks/task-complete',
        '/internal/webhooks/compliance-report'
      );
      if (!task.webhookUrl.includes('/internal/webhooks/task-complete')) {
        logger.warn(
          { taskId, webhookUrl: task.webhookUrl },
          'Compliance report webhook URL does not contain expected path — skipping delivery'
        );
      } else {
        void webhookClient
          .send({
            url: complianceReportUrl,
            secret: task.webhookSecret,
            payload: {
              taskId: input.taskId,
              prNumber: input.prNumber,
              report: result.report,
              model: result.model,
              promptVersion: result.promptVersion,
              costUsd: result.costUsd,
              workerType: input.workerType,
              transcriptTooLong: result.transcriptTooLong,
            },
            taskId,
          })
          .then((webhookResult) => {
            if (webhookResult.ok) {
              logger.info({ taskId }, 'Compliance report webhook delivered');
            } else {
              logger.warn(
                { taskId, error: webhookResult.error.message },
                'Compliance report webhook delivery failed'
              );
            }
          })
          .catch((error: unknown) => {
            logger.warn(
              { taskId, error: getErrorMessage(error) },
              'Compliance report webhook send error'
            );
          });
      }
    } else {
      appendOrchestratorTaskLog(
        logForwarder,
        taskId,
        'Compliance validation completed without result'
      );
      logger.warn({ taskId }, 'Compliance validation completed without result');
    }
  } catch (error) {
    appendOrchestratorTaskLog(
      logForwarder,
      taskId,
      `Compliance validation error: ${getErrorMessage(error)}`
    );
    logger.error(
      { taskId, error: getErrorMessage(error) },
      'Compliance validation failed (non-fatal, task finalization continues)'
    );
  }
}
