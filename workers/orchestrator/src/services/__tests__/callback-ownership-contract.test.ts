import type { Logger } from '@intexuraos/common-core';
import { describe, expect, it, vi } from 'vitest';
import type { CreateTaskRequest } from '../../types/api.js';
import type { Task } from '../../types/task.js';
import { buildTaskCallbackUrl } from '../callback-url.js';
import type {
  AgentComplianceValidator,
  ComplianceValidationInput,
} from '../agent-compliance-validator.js';
import type { LogForwarder } from '../log-forwarder.js';
import { executeComplianceValidation } from '../task-dispatcher/metrics.js';
import { getTaskEventUrl } from '../task-dispatcher/prompts.js';
import { sendSetupFailureWebhook } from '../task-dispatcher/webhook-callbacks.js';
import type { WebhookClient } from '../webhook-client.js';

const productionCompletionUrl = 'https://intexuraos.cloud/api/code/internal/webhooks/task-complete';
const productionFallback = 'https://intexuraos.cloud/api/code';

function logger(): Logger {
  return {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  } as unknown as Logger;
}

describe('production task callback ownership', () => {
  it.each([
    ['logs', '/internal/logs'],
    ['metrics', '/internal/turn-metrics'],
    ['status', '/internal/code-tasks/status'],
    ['completion', '/internal/webhooks/task-complete'],
  ])('derives the %s callback from the task-provided production URL', (_channel, path) => {
    expect(buildTaskCallbackUrl(productionCompletionUrl, 'http://localhost:8128', path)).toBe(
      `${productionFallback}${path}`
    );
  });

  it('derives lifecycle callbacks from the task-provided production URL', () => {
    expect(getTaskEventUrl(productionCompletionUrl)).toBe(
      'https://intexuraos.cloud/api/code/internal/webhooks/task-event'
    );
    expect(getTaskEventUrl('https://task-owner.example/webhook')).toBe(
      'https://task-owner.example/internal/webhooks/task-event'
    );
  });

  it('delivers compliance reports to a task-provided custom owner without a marker', async () => {
    const send = vi.fn(async () => ({ ok: true as const, value: undefined }));
    const validationResult = {
      report: {},
      model: 'test-model',
      promptVersion: '1.0.0',
      costUsd: 0,
      transcriptTooLong: false,
    } as unknown as NonNullable<Awaited<ReturnType<AgentComplianceValidator['validate']>>>;
    const validator: AgentComplianceValidator = {
      validate: vi.fn(async () => validationResult),
    };
    const input: ComplianceValidationInput = {
      taskId: 'task_prod',
      prNumber: 1,
      repository: 'pbuchman/intexuraos',
      formattedTranscript: 'test',
      agentClaims: {
        outcome: 'implemented',
        superpowers_subagent_driven_dev: 'used',
        superpowers_requesting_code_review: 'used',
        gh_pr_url: 'https://github.com/pbuchman/intexuraos/pull/1',
        failure_reason: '',
        memory_ids_used: '',
        memory_ids_rejected: '',
        memory_usage_summary: '',
        summary: 'done',
      },
      workerType: 'auto',
    };
    const task = {
      taskId: 'task_prod',
      webhookUrl: 'https://task-owner.example/webhook',
      webhookSecret: 'task-secret',
    } as Task;

    await executeComplianceValidation(
      validator,
      { send } as unknown as WebhookClient,
      { appendChunk: vi.fn() } as unknown as LogForwarder,
      logger(),
      task,
      input
    );
    await vi.waitFor(() => {
      expect(send).toHaveBeenCalled();
    });

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://task-owner.example/internal/webhooks/compliance-report',
      })
    );
  });

  it('delivers terminal setup failure to the task-provided production owner', async () => {
    const send = vi.fn(async () => ({ ok: true as const, value: undefined }));
    const request = {
      taskId: 'task_prod',
      webhookUrl: productionCompletionUrl,
      webhookSecret: 'task-secret',
    } as CreateTaskRequest;

    await sendSetupFailureWebhook(
      { send } as unknown as WebhookClient,
      logger(),
      request,
      'setup failed',
      new Error('test')
    );

    expect(send).toHaveBeenCalledWith(expect.objectContaining({ url: productionCompletionUrl }));
  });

  it('uses the production fallback only when the optional callback contract omits a URL', () => {
    expect(buildTaskCallbackUrl(undefined, productionFallback, '/internal/logs')).toBe(
      'https://intexuraos.cloud/api/code/internal/logs'
    );
  });

  it('never redirects a provided callback owner to the static production fallback', () => {
    expect(
      buildTaskCallbackUrl(
        'https://task-owner.example/webhooks/task-complete',
        productionFallback,
        '/internal/logs'
      )
    ).toBe('https://task-owner.example/internal/logs');

    expect(() =>
      buildTaskCallbackUrl('not a callback URL', productionFallback, '/internal/logs')
    ).toThrow('Task webhook URL is present but invalid');
  });
});
