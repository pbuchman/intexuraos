/**
 * Use case: start Execution Agent implementation from a completed planning task.
 *
 * Thin facade that wires together the two phases of the workflow:
 *   1. prepareSubmission — gather context, validate, compute effective worker
 *      type, and merge the plan PR.
 *   2. dispatchSubmission — create + enqueue one execution task for the
 *      original planned issue.
 *
 * Public types, the EXECUTION_AGENT_PROMPT constant, and the top-level deps
 * shape are re-exported here so callers outside this module do not need to
 * reach into the sibling files.
 */

import { err, getErrorMessage, type Result } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import type { CodeTaskRepository } from '../../domain/repositories/codeTaskRepository.js';
import type { LinearAgentClient } from '../../domain/ports/linearAgentClient.js';
import type { TaskEnqueueService } from '../../domain/services/taskEnqueueService.js';
import type { MetricsClient } from '../../domain/services/metrics.js';
import type { WorkerSettingsRepository } from '../../domain/ports/workerSettingsRepository.js';
import type { GitHubPRClient } from '../ports/gitHubPRClient.js';
import type { UserServiceClient } from '@intexuraos/internal-clients';
import { prepareSubmission } from './submitToExecutionAgent/prepareSubmission.js';
import { dispatchSubmission } from './submitToExecutionAgent/dispatchSubmission.js';
import type {
  SubmitToExecutionAgentError,
  SubmitToExecutionAgentRequest,
  SubmitToExecutionAgentResult,
} from './submitToExecutionAgent/types.js';

export {
  EXECUTION_AGENT_PROMPT,
  type SubmitToExecutionAgentRequest,
  type SubmitToExecutionAgentResult,
  type SubmitToExecutionAgentErrorCode,
  type SubmitToExecutionAgentError,
} from './submitToExecutionAgent/types.js';

export interface SubmitToExecutionAgentDeps {
  logger: Logger;
  codeTaskRepo: CodeTaskRepository;
  linearAgentClient: LinearAgentClient;
  taskEnqueueService: TaskEnqueueService;
  metricsClient: MetricsClient;
  workerSettingsRepo: WorkerSettingsRepository;
  orchestratorSecret: string;
  gitHubPRClient: GitHubPRClient;
  userServiceClient: UserServiceClient;
}

/**
 * Submit to Execution Agent — thin facade over prepare + dispatch phases.
 */
export async function submitToExecutionAgent(
  deps: SubmitToExecutionAgentDeps,
  request: SubmitToExecutionAgentRequest,
): Promise<Result<SubmitToExecutionAgentResult, SubmitToExecutionAgentError>> {
  let prepared: Awaited<ReturnType<typeof prepareSubmission>>;
  try {
    prepared = await prepareSubmission(
      {
        logger: deps.logger,
        codeTaskRepo: deps.codeTaskRepo,
        linearAgentClient: deps.linearAgentClient,
        workerSettingsRepo: deps.workerSettingsRepo,
        gitHubPRClient: deps.gitHubPRClient,
        userServiceClient: deps.userServiceClient,
      },
      request,
    );
  } catch (e) {
    // prepareSubmission throws only for malformed request input (missing
    // originalTaskId / userId). Convert the thrown Error into a structured
    // Result so the public facade's contract stays Result-based.
    const message = getErrorMessage(e, 'Invalid request');
    deps.logger.warn({ request, error: message }, 'submitToExecutionAgent: malformed request');
    return err({ code: 'invalid_status', message });
  }

  if (!prepared.ok) {
    return prepared;
  }

  return await dispatchSubmission(
    {
      logger: deps.logger,
      codeTaskRepo: deps.codeTaskRepo,
      linearAgentClient: deps.linearAgentClient,
      taskEnqueueService: deps.taskEnqueueService,
      orchestratorSecret: deps.orchestratorSecret,
    },
    prepared.value,
  );
}
