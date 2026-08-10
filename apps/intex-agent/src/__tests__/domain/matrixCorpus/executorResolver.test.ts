import { createHash } from 'node:crypto';

import {
  canonicalMatrixCorpusStrictToolMockProfileV1,
  type StrictToolMockProfileV1,
} from '@intexuraos/http-contracts';
import { describe, expect, it, vi } from 'vitest';

import type { IntexAgentToolExecutor } from '../../../domain/agent/toolDefinitions.js';
import type { IntexAgentSession } from '../../../domain/sessions/types.js';
import {
  createIntexAgentExecutorResolver,
  MatrixCorpusExecutorResolutionError,
  type MatrixCorpusExecutorExecutionContext,
} from '../../../domain/matrixCorpus/executorResolver.js';

describe('Intex Agent executor resolver', () => {
  it('does not construct any production executor until an ordinary session resolves it', () => {
    const productionExecutor = unusedExecutor();
    const createOrdinaryExecutor = vi.fn(() => productionExecutor);
    const createMatrixCorpusExecutor = vi.fn(() => unusedExecutor());
    const resolver = createIntexAgentExecutorResolver({
      createOrdinaryExecutor,
      createMatrixCorpusExecutor,
    });

    expect(createOrdinaryExecutor).not.toHaveBeenCalled();
    expect(createMatrixCorpusExecutor).not.toHaveBeenCalled();
    expect(resolver.resolve({ session: ordinarySession() })).toBe(productionExecutor);
    expect(createOrdinaryExecutor).toHaveBeenCalledOnce();
    expect(createMatrixCorpusExecutor).not.toHaveBeenCalled();
  });

  it.each(['normal', 'confirmation'] as const)(
    'resolves only the strict mock executor for a Matrix %s flow',
    (flow) => {
      const createOrdinaryExecutor = vi.fn(() => {
        throw new Error('Production executor must be unreachable');
      });
      const strictExecutor = unusedExecutor();
      const createMatrixCorpusExecutor = vi.fn(() => strictExecutor);
      const resolver = createIntexAgentExecutorResolver({
        createOrdinaryExecutor,
        createMatrixCorpusExecutor,
      });
      const session = matrixSession();

      expect(
        resolver.resolve({
          session,
          matrixCorpus: matrixExecutionContext(flow),
        })
      ).toBe(strictExecutor);
      expect(createOrdinaryExecutor).not.toHaveBeenCalled();
      expect(createMatrixCorpusExecutor).toHaveBeenCalledWith(
        expect.objectContaining({
          profile: expect.objectContaining({ digest: session.matrixCorpusProfile?.mockProfileDigest }),
          turnIndex: 0,
          ingestReceiptId: `receipt_${flow}`,
        })
      );
    }
  );

  it('fails closed when Matrix execution context is absent', () => {
    const resolver = createIntexAgentExecutorResolver({
      createOrdinaryExecutor: vi.fn(() => unusedExecutor()),
      createMatrixCorpusExecutor: vi.fn(() => unusedExecutor()),
    });

    expect(() => resolver.resolve({ session: matrixSession() })).toThrow(
      expect.objectContaining({
        name: 'MatrixCorpusExecutorResolutionError',
        code: 'MISSING_MATRIX_EXECUTION_CONTEXT',
      })
    );
  });

  it('fails closed on an immutable profile digest mismatch before any executor factory runs', () => {
    const createOrdinaryExecutor = vi.fn(() => unusedExecutor());
    const createMatrixCorpusExecutor = vi.fn(() => unusedExecutor());
    const resolver = createIntexAgentExecutorResolver({
      createOrdinaryExecutor,
      createMatrixCorpusExecutor,
    });
    const session = matrixSession();
    if (session.matrixCorpusProfile === undefined) throw new Error('Missing test profile');
    session.matrixCorpusProfile.mockProfileDigest = 'f'.repeat(64);

    expect(() =>
      resolver.resolve({ session, matrixCorpus: matrixExecutionContext('normal') })
    ).toThrow(expect.objectContaining({ code: 'INVALID_MATRIX_MOCK_PROFILE' }));
    expect(createOrdinaryExecutor).not.toHaveBeenCalled();
    expect(createMatrixCorpusExecutor).not.toHaveBeenCalled();
  });

  it('fails closed when the reviewed catalog schedule and immutable profile differ', () => {
    const createMatrixCorpusExecutor = vi.fn(() => unusedExecutor());
    const resolver = createIntexAgentExecutorResolver({
      createOrdinaryExecutor: vi.fn(() => unusedExecutor()),
      createMatrixCorpusExecutor,
    });

    expect(() =>
      resolver.resolve({
        session: matrixSession(),
        matrixCorpus: {
          ...matrixExecutionContext('normal'),
          expectedSchedule: [
            { turnIndex: 0, toolName: 'create_note', ordinal: 1 },
          ],
        },
      })
    ).toThrow(expect.objectContaining({ code: 'INVALID_MATRIX_MOCK_PROFILE' }));
    expect(createMatrixCorpusExecutor).not.toHaveBeenCalled();
  });

  it('rejects a Matrix-only context on an ordinary session', () => {
    const resolver = createIntexAgentExecutorResolver({
      createOrdinaryExecutor: vi.fn(() => unusedExecutor()),
      createMatrixCorpusExecutor: vi.fn(() => unusedExecutor()),
    });

    expect(() =>
      resolver.resolve({
        session: ordinarySession(),
        matrixCorpus: matrixExecutionContext('normal'),
      })
    ).toThrow(expect.objectContaining({ code: 'CROSS_LANE_EXECUTION_CONTEXT' }));
  });

  it('exports a narrow typed error without storing session or profile data', () => {
    const error = new MatrixCorpusExecutorResolutionError('INVALID_MATRIX_MOCK_PROFILE');
    expect(error.message).toBe('Matrix corpus executor resolution failed: INVALID_MATRIX_MOCK_PROFILE');
    expect(error).not.toHaveProperty('session');
    expect(error).not.toHaveProperty('profile');
  });
});

function matrixExecutionContext(
  flow: 'normal' | 'confirmation'
): MatrixCorpusExecutorExecutionContext {
  return {
    flow,
    turnIndex: 0,
    ingestReceiptId: `receipt_${flow}`,
    expectedSchedule: [],
    recordExecutionBoundary: async () => undefined,
    recordToolCallStarted: async () => undefined,
    registerExpectedProviderCall: () => undefined,
    recordProviderCall: async () => undefined,
  } as const;
}

function ordinarySession(): IntexAgentSession {
  return {
    id: 'session_ordinary',
    userId: 'auth0:user_1',
    channel: 'whatsapp',
    status: 'active',
    startedAt: '2026-07-20T10:00:00.000Z',
    lastUserMessageAt: '2026-07-20T10:00:00.000Z',
    startReason: 'no_active_session',
  };
}

function matrixSession(): IntexAgentSession {
  const mockProfile = profile();
  return {
    ...ordinarySession(),
    id: 'session_matrix',
    matrixCorpusProfile: {
      version: 1,
      kind: 'matrix_corpus',
      runtimeAudience: 'hetzner-prod',
      leaseFence: '7',
      runId: 'run_1',
      scenarioId: 'scenario_1',
      scenarioNumber: 1,
      scenarioLabel: 'Scenario 001/020',
      executionMode: 'strict_mock_tools',
      agentModel: 'or:deepseek/deepseek-v4-flash',
      evaluatorModel: 'or:minimax/minimax-m3',
      promptPreferencesVersion: 0,
      promptPreferencesDigest: 'a'.repeat(64),
      userTimeZone: 'Europe/Warsaw',
      mockProfile,
      mockProfileDigest: createHash('sha256')
        .update(canonicalMatrixCorpusStrictToolMockProfileV1(mockProfile), 'utf8')
        .digest('hex'),
      expectedToolSchedule: [],
    },
    lastEventSequence: 0,
  };
}

function profile(): StrictToolMockProfileV1 {
  return {
    version: 1,
    calls: [],
    forbiddenSelections: [],
    unexpectedKnownToolPolicy: 'behavioral_failure_no_execution',
  };
}

function unusedExecutor(): IntexAgentToolExecutor {
  const unused = async (): Promise<string> => JSON.stringify({ status: 'unused' });
  return {
    createNote: unused,
    createCalendarEvent: unused,
    updateCalendarEvent: unused,
    queryCalendarEvents: unused,
    createResearch: unused,
    createLink: unused,
    createCodeTask: unused,
    saveExternal: unused,
    getUserPreferences: unused,
    addUserPreference: unused,
    updateUserPreference: unused,
    deleteUserPreference: unused,
  };
}
