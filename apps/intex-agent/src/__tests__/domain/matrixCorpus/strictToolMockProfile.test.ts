import { createHash } from 'node:crypto';

import {
  canonicalMatrixCorpusStrictToolMockProfileV1,
  type IntexAgentToolNameV1,
  type StrictMockResultV1,
  type StrictToolMockProfileV1,
} from '@intexuraos/http-contracts';
import { describe, expect, it } from 'vitest';

import {
  decodeStrictToolMockProfile,
  MATRIX_CORPUS_CANONICAL_TOOL_NAMES,
} from '../../../domain/matrixCorpus/strictToolMockProfile.js';

const allTools = [
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

describe('strict Matrix corpus tool-mock profile', () => {
  it('decodes the closed schedule for all 12 canonical tools and freezes the snapshot', () => {
    const profile = profileForAllTools();
    const decoded = decodeStrictToolMockProfile({
      profile,
      expectedDigest: digest(profile),
      expectedSchedule: profile.calls.map(({ turnIndex, toolName, ordinal }) => ({
        turnIndex,
        toolName,
        ordinal,
      })),
    });

    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(MATRIX_CORPUS_CANONICAL_TOOL_NAMES).toEqual(allTools);
    expect(Object.isFrozen(decoded.profile)).toBe(true);
    expect(Object.isFrozen(decoded.profile.calls)).toBe(true);
    expect(decoded.profile.calls.map((call) => call.toolName)).toEqual(allTools);
    expect(decoded.findCall({ turnIndex: 0, toolName: 'create_note', ordinal: 1 })).toEqual(
      profile.calls[0]
    );

    expect(() => {
      (decoded.profile.calls as unknown as unknown[]).push({});
    }).toThrow();
  });

  it('supports repeated calls with ordinals scoped to tool and turn', () => {
    const profile = baseProfile({
      calls: [
        call(0, 'create_note', 1),
        call(0, 'create_note', 2),
        call(1, 'create_note', 1),
      ],
    });

    const decoded = decodeStrictToolMockProfile({
      profile,
      expectedDigest: digest(profile),
      expectedSchedule: profile.calls.map(({ turnIndex, toolName, ordinal }) => ({
        turnIndex,
        toolName,
        ordinal,
      })),
    });

    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.callsFor(0, 'create_note').map((entry) => entry.ordinal)).toEqual([1, 2]);
    expect(decoded.callsFor(1, 'create_note').map((entry) => entry.ordinal)).toEqual([1]);
    expect(decoded.callsFor(2, 'create_note')).toEqual([]);
  });

  it.each([
    ['missing profile', undefined, 'INVALID_PROFILE'],
    ['unknown field', { ...baseProfile(), extra: true }, 'INVALID_PROFILE'],
    [
      'tool/result mismatch',
      baseProfile({
        calls: [
          {
            ...call(0, 'create_note', 1),
            outcome: { kind: 'success', result: resultFor('create_research') },
          },
        ],
      }),
      'INVALID_PROFILE',
    ],
  ] as const)('rejects %s without a permissive default', (_label, profile, code) => {
    expect(
      decodeStrictToolMockProfile({
        profile,
        expectedDigest: '0'.repeat(64),
        expectedSchedule: [],
      })
    ).toEqual({ ok: false, code });
  });

  it('rejects a valid profile whose immutable digest does not match', () => {
    expect(
      decodeStrictToolMockProfile({
        profile: baseProfile(),
        expectedDigest: 'f'.repeat(64),
        expectedSchedule: [],
      })
    ).toEqual({ ok: false, code: 'DIGEST_MISMATCH' });
  });

  it('rejects missing and extra entries relative to the catalog-declared schedule', () => {
    const profile = baseProfile({ calls: [call(0, 'create_note', 1)] });

    expect(
      decodeStrictToolMockProfile({
        profile,
        expectedDigest: digest(profile),
        expectedSchedule: [],
      })
    ).toEqual({ ok: false, code: 'UNEXPECTED_SCHEDULE_ENTRY' });
    expect(
      decodeStrictToolMockProfile({
        profile: baseProfile(),
        expectedDigest: digest(baseProfile()),
        expectedSchedule: [{ turnIndex: 0, toolName: 'create_note', ordinal: 1 }],
      })
    ).toEqual({ ok: false, code: 'MISSING_SCHEDULE_ENTRY' });
  });
});

function profileForAllTools(): StrictToolMockProfileV1 {
  return baseProfile({
    calls: allTools.map((toolName, index) => ({
      turnIndex: index,
      toolName,
      ordinal: 1,
      outcome: { kind: 'success', result: resultFor(toolName) },
    })),
  });
}

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

function call(
  turnIndex: number,
  toolName: IntexAgentToolNameV1,
  ordinal: number
): StrictToolMockProfileV1['calls'][number] {
  return {
    turnIndex,
    toolName,
    ordinal,
    outcome: { kind: 'success', result: resultFor(toolName) },
  };
}

function resultFor(toolName: IntexAgentToolNameV1): StrictMockResultV1 {
  switch (toolName) {
    case 'create_note':
    case 'create_research':
    case 'save_external':
      return { toolName, status: 'completed', message: 'Synthetic success' };
    case 'create_calendar_event':
      return {
        toolName,
        status: 'completed',
        eventId: 'mock_event_1',
        summary: 'Synthetic event',
      };
    case 'update_calendar_event':
      return {
        toolName,
        status: 'completed',
        eventId: 'mock_event_1',
        summary: 'Synthetic event',
        attendeesAdded: ['patryk@example.com'],
      };
    case 'query_calendar_events':
      return { toolName, status: 'completed', mode: 'count', count: 0 };
    case 'create_link':
      return {
        toolName,
        status: 'completed',
        bookmarkId: 'mock_bookmark_1',
        resourceUrl: 'https://mock.invalid/bookmarks/1',
      };
    case 'create_code_task':
      return { toolName, status: 'completed', codeTaskId: 'mock_code_task_1' };
    case 'get_user_preferences':
      return { toolName, status: 'completed', currentVersion: 0, items: [] };
    case 'add_user_preference':
    case 'update_user_preference':
    case 'delete_user_preference':
      return {
        toolName,
        status: 'completed',
        currentVersion: 1,
        changedItemId: 'mock_pref_1',
      };
  }
}

function digest(profile: StrictToolMockProfileV1): string {
  return createHash('sha256')
    .update(canonicalMatrixCorpusStrictToolMockProfileV1(profile), 'utf8')
    .digest('hex');
}
