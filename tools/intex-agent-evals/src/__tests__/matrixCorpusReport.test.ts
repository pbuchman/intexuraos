import { describe, expect, it, vi } from 'vitest';
import {
  MatrixCorpusReportV1Schema,
  renderMatrixCorpusReportMarkdown,
  type MatrixCorpusReportV1,
} from '../matrixCorpus/reportSchema.js';
import {
  publishMatrixCorpusArtifacts,
  stageMatrixCorpusArtifacts,
  type StagedMatrixCorpusArtifacts,
  type MatrixCorpusArtifactPort,
  type MatrixCorpusArtifactDeliveryPort,
} from '../matrixCorpus/reportArtifacts.js';

const digest = 'a'.repeat(64);
const revision = 'b'.repeat(40);

function counts(): MatrixCorpusReportV1['cleanup']['retention']['runs'] {
  return {
    observation: 'complete',
    considered: 0,
    retained: 0,
    removed: 0,
    missing: 0,
    failed: 0,
  };
}

function usage(logicalCalls = 0): MatrixCorpusReportV1['usage']['agent'] {
  return {
    logicalCalls,
    repairCount: 0,
    inputTokens: logicalCalls,
    outputTokens: logicalCalls,
    totalTokens: logicalCalls * 2,
    costNanoUsd: logicalCalls,
    costComplete: true,
  };
}

const PASS_TOOL_ROWS: Readonly<
  Record<
    string,
    readonly {
      toolName: MatrixCorpusReportV1['scenarios'][number]['tools'][number]['toolName'];
      turnIndex: number;
      count?: number;
    }[]
  >
> = {
  'intex-eval-001': [{ turnIndex: 1, toolName: 'create_note' }],
  'intex-eval-002': [{ turnIndex: 1, toolName: 'create_calendar_event' }],
  'intex-eval-003': [{ turnIndex: 2, toolName: 'create_calendar_event' }],
  'intex-eval-004': [{ turnIndex: 2, toolName: 'create_note' }],
  'intex-eval-006': [
    { turnIndex: 1, toolName: 'create_note' },
    { turnIndex: 3, toolName: 'create_note' },
  ],
  'intex-eval-007': [{ turnIndex: 1, toolName: 'create_note' }],
  'intex-eval-008': [
    { turnIndex: 0, toolName: 'query_calendar_events' },
    { turnIndex: 2, toolName: 'query_calendar_events' },
    { turnIndex: 3, toolName: 'update_calendar_event', count: 4 },
  ],
  'intex-eval-010': [{ turnIndex: 1, toolName: 'create_note' }],
  'intex-eval-011': [{ turnIndex: 0, toolName: 'query_calendar_events' }],
  'intex-eval-012': [{ turnIndex: 1, toolName: 'create_research' }],
  'intex-eval-013': [{ turnIndex: 1, toolName: 'create_link' }],
  'intex-eval-014': [{ turnIndex: 1, toolName: 'create_code_task' }],
  'intex-eval-015': [{ turnIndex: 1, toolName: 'save_external' }],
  'intex-eval-016': [{ turnIndex: 0, toolName: 'get_user_preferences' }],
  'intex-eval-017': [{ turnIndex: 1, toolName: 'add_user_preference' }],
  'intex-eval-018': [{ turnIndex: 1, toolName: 'update_user_preference' }],
  'intex-eval-019': [{ turnIndex: 1, toolName: 'delete_user_preference' }],
  'intex-eval-020': [{ turnIndex: 19, toolName: 'create_note' }],
};
const PASS_TURN_COUNTS = [2, 2, 3, 3, 1, 4, 2, 4, 1, 2, 1, 2, 2, 2, 2, 1, 2, 2, 2, 20] as const;

function report(status: 'pending' | 'ready' = 'pending'): MatrixCorpusReportV1 {
  return {
    schemaVersion: 1,
    runId: 'eval-123e4567-e89b-12d3-a456-426614174000',
    command: 'matrix-corpus',
    requestedRevision: revision,
    deployedRevision: revision,
    accountAlias: 'operator-test',
    runnerHost: 'home-dev',
    runtimeAudience: 'hetzner-prod',
    environmentAlias: 'prod',
    catalog: { digest, scenarioCount: 20, turnCount: 60 },
    agentModel: 'or:deepseek/deepseek-v4-flash',
    evaluatorModel: 'or:minimax/minimax-m3',
    executionMode: 'real_matrix_whatsapp_strict_mock_tools',
    startedAt: '2026-07-20T05:00:00.000Z',
    completedAt: '2026-07-20T05:01:00.000Z',
    durationMs: 60_000,
    terminal: {
      lifecycle: 'completed',
      verdict: 'passed',
      acknowledged: status === 'ready',
      leaseReleased: status === 'ready',
      runOutcomeCode: 'PASS',
      exitCode: 0,
    },
    preflight: [
      'revision',
      'services',
      'user',
      'account_tuple',
      'matrix',
      'whatsapp',
      'capability',
      'catalog',
      'models',
      'run_lease',
      'artifact',
    ].map((check) => ({
      check,
      status: 'passed',
      code: null,
    })) as MatrixCorpusReportV1['preflight'],
    totals: {
      scenariosPlanned: 20,
      scenariosExecuted: 20,
      scenariosPassed: 20,
      scenariosFailed: 0,
      scenariosNotRun: 0,
      turnsPlanned: 60,
      turnsSent: 60,
      turnsCorrelated: 60,
      turnsCompleted: 60,
      sessionsExpected: 20,
      sessionsCreated: 20,
      sessionsContinued: 39,
      sessionsClosed: 1,
      confirmationsRequested: 17,
      confirmationsAccepted: 17,
      confirmationsRejected: 0,
      confirmationsCompleted: 17,
      repliesExpected: 60,
      repliesObserved: 60,
      repliesJudged: 60,
      toolSelections: 24,
      mockCompletions: 24,
      mockFailures: 0,
      productionExecutorResolutions: 0,
      productionExecutorAdmissions: 0,
    },
    usage: { agent: usage(20), evaluator: usage(60), totalCostNanoUsd: 80, costComplete: true },
    scenarios: Array.from({ length: 20 }, (_, offset) => {
      const scenarioId = `intex-eval-${String(offset + 1).padStart(3, '0')}`;
      const plannedTurns = PASS_TURN_COUNTS[offset] ?? 0;
      let agentLogicalCalls = 1;
      if (offset === 7) agentLogicalCalls = 2;
      if (offset === 8) agentLogicalCalls = 0;
      return {
        scenarioId,
        ordinal: offset + 1,
        safeTitle: `Scenario ${offset + 1}`,
        scenarioDigest: digest,
        lifecycle: 'completed' as const,
        verdict: 'passed' as const,
        plannedTurns,
        completedTurns: plannedTurns,
        sessionReferenceDigest: String(offset + 1).padStart(64, '0'),
        transport: {
          matrixSends: plannedTurns,
          whatsappIngress: plannedTurns,
          whatsappEgress: plannedTurns,
          assistantReplies: plannedTurns,
          matrixMirrors: plannedTurns,
        },
        tools: (PASS_TOOL_ROWS[scenarioId] ?? []).map(({ count = 1, ...tool }) => ({
          ...tool,
          expected: count,
          selected: count,
          completed: count,
          failed: 0,
        })),
        deterministic: { passed: 1, failed: 0 },
        judge: {
          status: 'passed' as const,
          passed: true,
          score: 100,
          criteriaPassed: plannedTurns,
          criteriaFailed: 0,
          usage: usage(plannedTurns),
        },
        agentUsage: usage(agentLogicalCalls),
        strictMockProof: {
          version: 1 as const,
          status: 'passed' as const,
          mockProfileDigest: digest,
          productionExecutorResolutions: 0 as const,
          productionExecutorAdmissions: 0 as const,
        },
        failureCodes: [],
      };
    }),
    cleanup: {
      contextFinalization: 'passed',
      scenarioContextsDeleted: 20,
      runContextsDeleted: 1,
      retainedSessionsUnchanged: 'not_observed',
      retainedProjectionsUnchanged: 'not_observed',
      quiesce: 'passed',
      drain: 'passed',
      finalizingCandidate: 'passed',
      releasePending: 'passed',
      terminalAcknowledgement: 'passed',
      leaseRelease: 'passed',
      retention: {
        status: 'passed',
        runs: counts(),
        sessions: counts(),
        capabilities: counts(),
        artifacts: counts(),
      },
    },
    artifactDelivery: {
      status,
      stagedJsonDigest: status === 'ready' ? digest : null,
      stagedMarkdownDigest: status === 'ready' ? digest : null,
      failureCode: null,
    },
    failures: [],
  };
}

describe('Matrix corpus report agent model', () => {
  it('accepts MiniMax M3 independently for both agent and evaluator roles', () => {
    const parsed = MatrixCorpusReportV1Schema.parse({
      ...report('ready'),
      agentModel: 'or:minimax/minimax-m3',
    });

    expect(parsed.agentModel).toBe('or:minimax/minimax-m3');
    expect(parsed.evaluatorModel).toBe('or:minimax/minimax-m3');
    const markdown = renderMatrixCorpusReportMarkdown(parsed);
    expect(markdown).toContain('- Agent: or:minimax/minimax-m3');
    expect(markdown).toContain('- Evaluator: or:minimax/minimax-m3');
  });
});

function artifactHarness(): {
  order: string[];
  files: MatrixCorpusArtifactPort;
  delivery: MatrixCorpusArtifactDeliveryPort;
} {
  const order: string[] = [];
  const files: MatrixCorpusArtifactPort = {
    ensurePrivateDirectory: vi.fn(async () => {
      order.push('directory');
      return true;
    }),
    writePrivateExclusive: vi.fn(async (path) => {
      order.push(`stage:${path.split('/').at(-1)}`);
      return true;
    }),
    replacePrivate: vi.fn(async (path) => {
      order.push(`candidate:${path.split('/').at(-1)}`);
      return true;
    }),
    rename: vi.fn(async (_source, destination) => {
      order.push(`publish:${destination.split('/').at(-1)}`);
      return true;
    }),
    remove: vi.fn(async () => undefined),
    removeExactPrivateDirectory: vi.fn(async () => 'removed' as const),
  };
  const delivery: MatrixCorpusArtifactDeliveryPort = {
    recordStaged: vi.fn(async () => {
      order.push('delivery:staged');
      return { ok: true, revision: 22 };
    }),
    markReady: vi.fn(async () => {
      order.push('delivery:ready');
      return true;
    }),
    markFailed: vi.fn(async () => {
      order.push('delivery:failed');
    }),
  };
  return { order, files, delivery };
}

function readyReport(staged: StagedMatrixCorpusArtifacts): MatrixCorpusReportV1 {
  const candidate = report('ready');
  return {
    ...candidate,
    artifactDelivery: {
      ...candidate.artifactDelivery,
      stagedJsonDigest: staged.jsonDigest,
      stagedMarkdownDigest: staged.markdownDigest,
    },
  };
}

describe('MatrixCorpusReportV1Schema', () => {
  it('accepts the closed report and derives deterministic Markdown only from it', () => {
    const candidate = report();
    expect(MatrixCorpusReportV1Schema.parse(candidate)).toEqual(candidate);
    const first = renderMatrixCorpusReportMarkdown(candidate);
    expect(first).toBe(renderMatrixCorpusReportMarkdown(structuredClone(candidate)));
    expect(first).toContain('or:deepseek/deepseek-v4-flash');
    expect(first).toContain('or:minimax/minimax-m3');
  });

  it.each([
    'userId',
    'sessionId',
    'capability',
    'token',
    'prompt',
    'reply',
    'rawArguments',
    'providerPayload',
    'rationale',
    'firebaseData',
    'error',
  ])('rejects forbidden unknown field %s at every strict boundary', (field) => {
    const candidate = { ...report(), [field]: 'private-sentinel' };
    expect(MatrixCorpusReportV1Schema.safeParse(candidate).success).toBe(false);
    expect(() => renderMatrixCorpusReportMarkdown(candidate)).toThrow();
  });

  it('rejects pass without complete integer nano-USD accounting and ready without both barriers', () => {
    expect(
      MatrixCorpusReportV1Schema.safeParse({
        ...report(),
        usage: { ...report().usage, totalCostNanoUsd: null, costComplete: false },
      }).success
    ).toBe(false);
    const ready = report('ready');
    expect(
      MatrixCorpusReportV1Schema.safeParse({
        ...ready,
        terminal: { ...ready.terminal, leaseReleased: false },
      }).success
    ).toBe(false);
  });
});

describe('matrix corpus artifact lifecycle', () => {
  it('stages hidden candidates and records their digests before finalizing', async () => {
    const harness = artifactHarness();
    const result = await stageMatrixCorpusArtifacts({
      artifactRoot: '/safe/.artifacts/intex-agent-evals',
      report: report(),
      files: harness.files,
      delivery: harness.delivery,
    });
    expect(result.ok).toBe(true);
    expect(harness.order).toEqual([
      'directory',
      'stage:.report.json.staged',
      'stage:.report.md.staged',
      'delivery:staged',
    ]);
  });

  it('publishes only after terminal acknowledgement and release, then marks ready', async () => {
    const harness = artifactHarness();
    const staged = await stageMatrixCorpusArtifacts({
      artifactRoot: '/safe/.artifacts/intex-agent-evals',
      report: report(),
      files: harness.files,
      delivery: harness.delivery,
    });
    if (!staged.ok) throw new Error('stage failed');
    harness.order.length = 0;
    const result = await publishMatrixCorpusArtifacts({
      staged: staged.value,
      report: readyReport(staged.value),
      terminalAcknowledged: true,
      leaseReleased: true,
      files: harness.files,
      delivery: harness.delivery,
    });
    expect(result.ok).toBe(true);
    expect(harness.order).toEqual([
      'candidate:report.json',
      'candidate:report.md',
      'candidate:report.commit.json',
      'publish:eval-123e4567-e89b-12d3-a456-426614174000',
      'delivery:ready',
    ]);
  });

  it('classifies a preterminal write failure as staging failure', async () => {
    const harness = artifactHarness();
    vi.mocked(harness.files.writePrivateExclusive).mockResolvedValueOnce(false);

    await expect(
      stageMatrixCorpusArtifacts({
        artifactRoot: '/safe/.artifacts/intex-agent-evals',
        report: report(),
        files: harness.files,
        delivery: harness.delivery,
      })
    ).resolves.toEqual({ ok: false, code: 'REPORT_STAGING_FAILED' });
    expect(harness.delivery.markFailed).toHaveBeenCalledWith({
      runId: report().runId,
      code: 'REPORT_STAGING_FAILED',
    });
    expect(harness.files.removeExactPrivateDirectory).toHaveBeenCalledWith(
      '/safe/.artifacts/intex-agent-evals/.eval-123e4567-e89b-12d3-a456-426614174000.staging'
    );
  });

  it('publishes the report pair with one directory rename and rolls back if ready CAS fails', async () => {
    const harness = artifactHarness();
    vi.mocked(harness.delivery.markReady).mockResolvedValueOnce(false);
    const staged = await stageMatrixCorpusArtifacts({
      artifactRoot: '/safe/.artifacts/intex-agent-evals',
      report: report(),
      files: harness.files,
      delivery: harness.delivery,
    });
    if (!staged.ok) throw new Error('stage failed');
    harness.order.length = 0;

    await expect(
      publishMatrixCorpusArtifacts({
        staged: staged.value,
        report: readyReport(staged.value),
        terminalAcknowledged: true,
        leaseReleased: true,
        files: harness.files,
        delivery: harness.delivery,
      })
    ).resolves.toEqual({ ok: false, code: 'REPORT_PUBLICATION_FAILED' });
    expect(harness.files.rename).toHaveBeenCalledTimes(1);
    expect(harness.files.removeExactPrivateDirectory).toHaveBeenCalledWith(
      '/safe/.artifacts/intex-agent-evals/eval-123e4567-e89b-12d3-a456-426614174000'
    );
  });

  it('fails closed and publishes nothing when either terminal barrier is absent', async () => {
    const harness = artifactHarness();
    const staged = await stageMatrixCorpusArtifacts({
      artifactRoot: '/safe/.artifacts/intex-agent-evals',
      report: report(),
      files: harness.files,
      delivery: harness.delivery,
    });
    if (!staged.ok) throw new Error('stage failed');
    harness.order.length = 0;
    await expect(
      publishMatrixCorpusArtifacts({
        staged: staged.value,
        report: readyReport(staged.value),
        terminalAcknowledged: true,
        leaseReleased: false,
        files: harness.files,
        delivery: harness.delivery,
      })
    ).resolves.toEqual({ ok: false, code: 'REPORT_VALIDATION_FAILED' });
    expect(harness.order).toEqual(['delivery:failed']);
  });

  it('rejects a ready report that is not bound to the exact staged run and candidate digests', async () => {
    const harness = artifactHarness();
    const staged = await stageMatrixCorpusArtifacts({
      artifactRoot: '/safe/.artifacts/intex-agent-evals',
      report: report(),
      files: harness.files,
      delivery: harness.delivery,
    });
    if (!staged.ok) throw new Error('stage failed');
    harness.order.length = 0;
    const mismatched = {
      ...readyReport(staged.value),
      artifactDelivery: {
        ...readyReport(staged.value).artifactDelivery,
        stagedJsonDigest: 'f'.repeat(64),
      },
    };

    await expect(
      publishMatrixCorpusArtifacts({
        staged: staged.value,
        report: mismatched,
        terminalAcknowledged: true,
        leaseReleased: true,
        files: harness.files,
        delivery: harness.delivery,
      })
    ).resolves.toEqual({ ok: false, code: 'REPORT_VALIDATION_FAILED' });
    expect(harness.files.replacePrivate).not.toHaveBeenCalled();
    expect(harness.files.rename).not.toHaveBeenCalled();
    expect(harness.files.removeExactPrivateDirectory).toHaveBeenCalledWith(
      staged.value.stagingDirectory
    );
  });

  it('rejects inconsistent scenario, aggregate, usage, and artifact evidence', () => {
    const valid = report('ready');
    expect(
      MatrixCorpusReportV1Schema.safeParse({
        ...valid,
        scenarios: valid.scenarios.map((scenario, offset) =>
          offset === 0 ? { ...scenario, scenarioId: 'intex-eval-020' } : scenario
        ),
      }).success
    ).toBe(false);
    expect(
      MatrixCorpusReportV1Schema.safeParse({
        ...valid,
        totals: { ...valid.totals, turnsCompleted: 58 },
      }).success
    ).toBe(false);
    expect(
      MatrixCorpusReportV1Schema.safeParse({
        ...valid,
        usage: {
          ...valid.usage,
          agent: { ...valid.usage.agent, totalTokens: 1 },
        },
      }).success
    ).toBe(false);
    expect(
      MatrixCorpusReportV1Schema.safeParse({
        ...valid,
        artifactDelivery: { ...valid.artifactDelivery, stagedJsonDigest: null },
      }).success
    ).toBe(false);
  });

  it('rejects PASS/exit 0 unless all 20 scenarios and 60 turns have closed passing evidence', () => {
    const valid = report('ready');
    const contradictory = {
      ...valid,
      scenarios: valid.scenarios.map((scenario, offset) =>
        offset === 19
          ? {
              ...scenario,
              lifecycle: 'not_run' as const,
              verdict: 'not_evaluated' as const,
              completedTurns: 0,
              judge: { ...scenario.judge, status: 'not_run' as const, passed: null },
              strictMockProof: { ...scenario.strictMockProof, status: 'not_run' as const },
            }
          : scenario
      ),
      totals: {
        ...valid.totals,
        scenariosExecuted: 19,
        scenariosPassed: 19,
        scenariosNotRun: 1,
        turnsCompleted: 56,
      },
    };
    expect(MatrixCorpusReportV1Schema.safeParse(contradictory).success).toBe(false);
  });

  it('accepts bounded MiniMax quorum votes in complete passing evidence', () => {
    const valid = report('ready');
    const withQuorum = {
      ...valid,
      usage: {
        ...valid.usage,
        evaluator: usage(62),
        totalCostNanoUsd: 82,
      },
      scenarios: valid.scenarios.map((scenario, offset) =>
        offset === 0
          ? {
              ...scenario,
              judge: {
                ...scenario.judge,
                usage: usage(4),
              },
            }
          : scenario
      ),
    };

    expect(MatrixCorpusReportV1Schema.safeParse(withQuorum).success).toBe(true);
    expect(
      MatrixCorpusReportV1Schema.safeParse({
        ...withQuorum,
        usage: {
          ...withQuorum.usage,
          evaluator: usage(65),
          totalCostNanoUsd: 85,
        },
        scenarios: withQuorum.scenarios.map((scenario, offset) =>
          offset === 0
            ? {
                ...scenario,
                judge: {
                  ...scenario.judge,
                  usage: usage(7),
                },
              }
            : scenario
        ),
      }).success
    ).toBe(false);
    expect(
      MatrixCorpusReportV1Schema.safeParse({
        ...withQuorum,
        usage: {
          ...withQuorum.usage,
          evaluator: usage(60),
          totalCostNanoUsd: 79,
        },
        scenarios: withQuorum.scenarios.map((scenario, offset) =>
          offset === 0
            ? {
                ...scenario,
                judge: {
                  ...scenario.judge,
                  usage: usage(3),
                },
              }
            : scenario
        ),
      }).success
    ).toBe(false);
    expect(
      MatrixCorpusReportV1Schema.safeParse({
        ...withQuorum,
        usage: {
          ...withQuorum.usage,
          evaluator: {
            ...withQuorum.usage.evaluator,
            repairCount: 5,
          },
        },
        scenarios: withQuorum.scenarios.map((scenario, offset) =>
          offset === 0
            ? {
                ...scenario,
                judge: {
                  ...scenario.judge,
                  usage: {
                    ...scenario.judge.usage,
                    repairCount: 5,
                  },
                },
              }
            : scenario
        ),
      }).success
    ).toBe(false);
  });

  it('rejects PASS with reused sessions, empty MiniMax evidence, failed ready cleanup, or a forged tool schedule', () => {
    const valid = report('ready');
    expect(
      MatrixCorpusReportV1Schema.safeParse({
        ...valid,
        scenarios: valid.scenarios.map((scenario) => ({
          ...scenario,
          sessionReferenceDigest: digest,
        })),
      }).success
    ).toBe(false);
    expect(
      MatrixCorpusReportV1Schema.safeParse({
        ...valid,
        usage: {
          ...valid.usage,
          evaluator: usage(0),
          totalCostNanoUsd: 20,
        },
        scenarios: valid.scenarios.map((scenario) => ({
          ...scenario,
          judge: {
            ...scenario.judge,
            criteriaPassed: 0,
            usage: usage(0),
          },
        })),
      }).success
    ).toBe(false);
    expect(
      MatrixCorpusReportV1Schema.safeParse({
        ...valid,
        cleanup: { ...valid.cleanup, retention: { ...valid.cleanup.retention, status: 'failed' } },
      }).success
    ).toBe(false);
    expect(
      MatrixCorpusReportV1Schema.safeParse({
        ...valid,
        scenarios: valid.scenarios.map((scenario, offset) =>
          offset === 0
            ? {
                ...scenario,
                tools: scenario.tools.map((tool) => ({
                  ...tool,
                  toolName: 'create_link' as const,
                })),
              }
            : scenario
        ),
      }).success
    ).toBe(false);
  });

  it('rejects PASS when the preflight list repeats one passing check and omits the others', () => {
    const valid = report('ready');
    expect(
      MatrixCorpusReportV1Schema.safeParse({
        ...valid,
        preflight: valid.preflight.map(() => ({
          check: 'revision' as const,
          status: 'passed' as const,
          code: null,
        })),
      }).success
    ).toBe(false);
  });

  it('rejects PASS when the 20-turn scenario is shortened below its scheduled tool turn', () => {
    const valid = report('ready');
    expect(
      MatrixCorpusReportV1Schema.safeParse({
        ...valid,
        scenarios: valid.scenarios.map((scenario, offset) =>
          offset === 4
            ? {
                ...scenario,
                plannedTurns: 18,
                completedTurns: 18,
                transport: {
                  matrixSends: 18,
                  whatsappIngress: 18,
                  whatsappEgress: 18,
                  assistantReplies: 18,
                  matrixMirrors: 18,
                },
                judge: { ...scenario.judge, usage: usage(18) },
              }
            : offset === 19
              ? {
                  ...scenario,
                  plannedTurns: 3,
                  completedTurns: 3,
                  transport: {
                    matrixSends: 3,
                    whatsappIngress: 3,
                    whatsappEgress: 3,
                    assistantReplies: 3,
                    matrixMirrors: 3,
                  },
                  judge: { ...scenario.judge, usage: usage(3) },
                }
              : scenario
        ),
      }).success
    ).toBe(false);
  });
});
