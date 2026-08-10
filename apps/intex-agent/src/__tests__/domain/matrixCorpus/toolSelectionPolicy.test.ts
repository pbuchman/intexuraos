import { createHash } from 'node:crypto';

import {
  canonicalMatrixCorpusStrictToolMockProfileV1,
  type IntexAgentToolNameV1,
  type StrictToolMockProfileV1,
} from '@intexuraos/http-contracts';
import { describe, expect, it } from 'vitest';

import {
  decodeStrictToolMockProfile,
  type DecodedStrictToolMockProfile,
} from '../../../domain/matrixCorpus/strictToolMockProfile.js';
import { evaluateMatrixCorpusToolSelection } from '../../../domain/matrixCorpus/toolSelectionPolicy.js';

const tools = [
  'create_note',
  'create_calendar_event',
  'update_calendar_event',
  'query_calendar_events',
  'create_research',
  'create_link',
  'create_code_task',
  'save_external',
  'get_user_preferences',
  'add_user_preference',
  'update_user_preference',
  'delete_user_preference',
] as const satisfies readonly IntexAgentToolNameV1[];

describe('Matrix corpus tool-selection policy', () => {
  it.each(tools)('allows the exact configured %s call', (toolName) => {
    const profile = decode(
      baseProfile({
        calls: [
          {
            turnIndex: 0,
            toolName,
            ordinal: 1,
            outcome: { kind: 'failure', code: 'MOCK_TOOL_FAILURE' },
          },
        ],
      })
    );

    expect(
      evaluateMatrixCorpusToolSelection({
        profile,
        turnIndex: 0,
        toolName,
        ordinal: 1,
      })
    ).toEqual({
      decision: 'allow',
      call: profile.profile.calls[0],
    });
  });

  it('classifies an explicitly forbidden known tool as behavioral failure without execution', () => {
    const profile = decode(
      baseProfile({ forbiddenSelections: [{ turnIndex: 2, toolName: 'create_note' }] })
    );

    expect(
      evaluateMatrixCorpusToolSelection({
        profile,
        turnIndex: 2,
        toolName: 'create_note',
        ordinal: 1,
      })
    ).toEqual({
      decision: 'behavioral_failure',
      code: 'FORBIDDEN_TOOL_SELECTED',
      toolName: 'create_note',
      turnIndex: 2,
      ordinal: 1,
    });
  });

  it.each([
    ['unexpected known selection', 0, 'create_link', 1],
    ['unexpected repeated ordinal', 0, 'create_note', 2],
  ] as const)('classifies %s as behavioral evidence', (_label, turnIndex, toolName, ordinal) => {
    const profile = decode(
      baseProfile({
        calls: [
          {
            turnIndex: 0,
            toolName: 'create_note',
            ordinal: 1,
            outcome: { kind: 'failure', code: 'MOCK_TOOL_FAILURE' },
          },
        ],
      })
    );

    expect(
      evaluateMatrixCorpusToolSelection({ profile, turnIndex, toolName, ordinal })
    ).toMatchObject({
      decision: 'behavioral_failure',
      code: 'UNEXPECTED_KNOWN_TOOL_SELECTED',
      toolName,
      turnIndex,
      ordinal,
    });
  });

  it('stops safely when a catalog-expected call has no configured result', () => {
    const profile = decode(baseProfile());

    expect(
      evaluateMatrixCorpusToolSelection({
        profile,
        turnIndex: 4,
        toolName: 'create_note',
        ordinal: 1,
        expectedByCatalog: true,
      })
    ).toEqual({
      decision: 'safety_stop',
      code: 'MISSING_EXPECTED_MOCK_CONFIGURATION',
      toolName: 'create_note',
      turnIndex: 4,
      ordinal: 1,
    });
  });

  it('stops safely for a tool outside the closed catalog', () => {
    expect(
      evaluateMatrixCorpusToolSelection({
        profile: decode(baseProfile()),
        turnIndex: 0,
        toolName: 'delete_everything',
        ordinal: 1,
      })
    ).toEqual({
      decision: 'safety_stop',
      code: 'TOOL_OUTSIDE_CLOSED_CATALOG',
      toolName: 'delete_everything',
      turnIndex: 0,
      ordinal: 1,
    });
  });
});

function baseProfile(
  overrides: Partial<StrictToolMockProfileV1> = {}
): StrictToolMockProfileV1 {
  return {
    version: 1,
    calls: [],
    forbiddenSelections: [],
    unexpectedKnownToolPolicy: 'behavioral_failure_no_execution',
    ...overrides,
  };
}

function decode(profile: StrictToolMockProfileV1): DecodedStrictToolMockProfile {
  const expectedDigest = createHash('sha256')
    .update(canonicalMatrixCorpusStrictToolMockProfileV1(profile), 'utf8')
    .digest('hex');
  const expectedSchedule = profile.calls.map(({ turnIndex, toolName, ordinal }) => ({
    turnIndex,
    toolName,
    ordinal,
  }));
  const result = decodeStrictToolMockProfile({ profile, expectedDigest, expectedSchedule });
  if (!result.ok) throw new Error(`Invalid test profile: ${result.code}`);
  return result;
}
