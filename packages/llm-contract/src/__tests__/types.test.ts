import { describe, expect, it } from 'vitest';

import { isMatrixCorpusLlmCallContextV1 } from '../types.js';

const context = {
  version: 1,
  runId: 'run_1',
  scenarioId: 'scenario_001',
  sessionId: 'session_1',
  turnIndex: 0,
  stage: 'agent_generation',
  callOrdinal: 1,
} as const;

describe('MatrixCorpusLlmCallContextV1', () => {
  it('accepts the exact closed provider-call context', () => {
    expect(isMatrixCorpusLlmCallContextV1(context)).toBe(true);
    expect(isMatrixCorpusLlmCallContextV1({ ...context, stage: 'calendar_update_planning' })).toBe(
      true
    );
  });

  it.each([
    { ...context, version: 2 },
    { ...context, turnIndex: 20 },
    { ...context, callOrdinal: 0 },
    { ...context, stage: 'confirmation' },
    { ...context, unknown: 'private' },
    { ...context, runId: '' },
  ])('rejects malformed or open context %#', (candidate) => {
    expect(isMatrixCorpusLlmCallContextV1(candidate)).toBe(false);
  });
});
