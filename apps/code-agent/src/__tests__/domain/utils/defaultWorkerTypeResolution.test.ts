import { describe, expect, it } from 'vitest';
import { resolveDefaultWorkerType } from '../../../domain/utils/defaultWorkerTypeResolution.js';

describe('resolveDefaultWorkerType', () => {
  it('uses the mapped default worker type for each supported agent type when request workerType is auto', () => {
    const settings = {
      defaultPlanningWorkerType: 'sonnet' as const,
      defaultExecutionWorkerType: 'codex' as const,
      defaultPullRequestWorkerType: 'qwen' as const,
      defaultReviewWorkerType: 'glm' as const,
      defaultRemediationWorkerType: 'kimi' as const,
    };

    expect(
      resolveDefaultWorkerType({
        agentType: 'planning',
        requestWorkerType: 'auto',
        settings,
      })
    ).toMatchObject({ workerType: 'sonnet', source: 'default' });

    expect(
      resolveDefaultWorkerType({
        agentType: 'execution',
        requestWorkerType: 'auto',
        settings,
      })
    ).toMatchObject({ workerType: 'codex', source: 'default' });

    expect(
      resolveDefaultWorkerType({
        agentType: 'pull_request',
        requestWorkerType: 'auto',
        settings,
      })
    ).toMatchObject({ workerType: 'qwen', source: 'default' });

    expect(
      resolveDefaultWorkerType({
        agentType: 'review',
        requestWorkerType: 'auto',
        settings,
      })
    ).toMatchObject({ workerType: 'glm', source: 'default' });

    expect(
      resolveDefaultWorkerType({
        agentType: 'remediation',
        requestWorkerType: 'auto',
        settings,
      })
    ).toMatchObject({ workerType: 'kimi', source: 'default' });
  });

  it('uses linear label override before explicit request, default, and auto fallback', () => {
    const result = resolveDefaultWorkerType({
      agentType: 'execution',
      labelWorkerType: 'opus',
      requestWorkerType: 'sonnet',
      settings: {
        defaultExecutionWorkerType: 'codex',
      },
    });

    expect(result).toMatchObject({ workerType: 'opus', source: 'label' });
  });

  it('uses explicit request workerType before the agent default and falls back to auto only when needed', () => {
    expect(
      resolveDefaultWorkerType({
        agentType: 'execution',
        requestWorkerType: 'sonnet',
        settings: {
          defaultExecutionWorkerType: 'codex',
        },
      })
    ).toMatchObject({ workerType: 'sonnet', source: 'request' });

    expect(
      resolveDefaultWorkerType({
        agentType: 'execution',
        requestWorkerType: 'auto',
        settings: null,
      })
    ).toMatchObject({ workerType: 'auto', source: 'fallback' });
  });
});
