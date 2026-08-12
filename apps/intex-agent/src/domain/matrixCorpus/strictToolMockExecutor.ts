import { createHash } from 'node:crypto';

import {
  strictMockResultV1Schema,
  type IntexAgentToolNameV1,
  type StrictMockResultV1,
} from '@intexuraos/http-contracts';

import type {
  AddUserPreferenceToolArgs,
  CreateCalendarEventToolArgs,
  CreateCodeTaskToolArgs,
  CreateLinkToolArgs,
  CreateNoteToolArgs,
  CreateResearchToolArgs,
  DeleteUserPreferenceToolArgs,
  IntexAgentToolExecutor,
  QueryCalendarEventsToolArgs,
  SaveExternalToolArgs,
  UpdateCalendarEventToolArgs,
  UpdateUserPreferenceToolArgs,
} from '../agent/toolDefinitions.js';
import { mapSafeToolFacts, type SafeToolFactV1 } from './safeEvidence.js';
import type { DecodedStrictToolMockProfile } from './strictToolMockProfile.js';
import {
  evaluateMatrixCorpusToolSelection,
  type MatrixCorpusToolSelectionDecision,
} from './toolSelectionPolicy.js';

type PreferenceMutationToolName =
  | 'add_user_preference'
  | 'update_user_preference'
  | 'delete_user_preference';

const CONFIRMATION_MUTATION_TOOL_NAMES = new Set<IntexAgentToolNameV1>([
  'create_note',
  'create_calendar_event',
  'update_calendar_event',
  'create_research',
  'create_link',
  'create_code_task',
  'save_external',
  'add_user_preference',
  'update_user_preference',
  'delete_user_preference',
]);

type PreferenceMutationArgs =
  | AddUserPreferenceToolArgs
  | UpdateUserPreferenceToolArgs
  | DeleteUserPreferenceToolArgs;

export interface MatrixCorpusStrictToolSelectionRecord {
  toolName: IntexAgentToolNameV1;
  turnIndex: number;
  ordinal: number;
  facts: readonly SafeToolFactV1[];
}

export interface MatrixCorpusStrictPreferenceOverlay {
  read(input: Readonly<{
    ingestReceiptId: string;
    toolName: 'get_user_preferences';
    turnIndex: number;
    ordinal: number;
    configuredResult: StrictMockResultV1;
  }>): Promise<StrictMockResultV1>;
  mutate(input: Readonly<{
    ingestReceiptId: string;
    mutationReceipt: string;
    toolName: PreferenceMutationToolName;
    turnIndex: number;
    ordinal: number;
    args: PreferenceMutationArgs;
    configuredResult: StrictMockResultV1;
  }>): Promise<StrictMockResultV1>;
}

export type MatrixCorpusStrictToolMockErrorCategory =
  | 'behavioral_failure'
  | 'safety_stop'
  | 'configured_failure';

export type MatrixCorpusStrictToolMockErrorCode =
  | Exclude<MatrixCorpusToolSelectionDecision, { decision: 'allow' }>['code']
  | 'MOCK_TOOL_FAILURE'
  | 'MISSING_PREAUTHORIZED_SELECTION'
  | 'MISSING_CALENDAR_EVENT_SNAPSHOT'
  | 'MISSING_PREFERENCE_OVERLAY'
  | 'PREFERENCE_OVERLAY_REJECTED'
  | 'PREFERENCE_OVERLAY_RESULT_MISMATCH'
  | 'TOOL_CALL_EVIDENCE_REJECTED';

export class MatrixCorpusStrictToolMockError extends Error {
  readonly category: MatrixCorpusStrictToolMockErrorCategory;
  readonly code: MatrixCorpusStrictToolMockErrorCode;

  constructor(
    category: MatrixCorpusStrictToolMockErrorCategory,
    code: MatrixCorpusStrictToolMockErrorCode
  ) {
    super(`Matrix corpus strict mock stopped: ${code}`);
    this.name = 'MatrixCorpusStrictToolMockError';
    this.category = category;
    this.code = code;
  }
}

export interface CreateStrictToolMockExecutorInput {
  profile: DecodedStrictToolMockProfile;
  turnIndex: number;
  ingestReceiptId: string;
  recordToolCallStarted: (input: MatrixCorpusStrictToolSelectionRecord) => Promise<void>;
  expectedByCatalog?: (input: Readonly<{
    toolName: IntexAgentToolNameV1;
    turnIndex: number;
    ordinal: number;
  }>) => boolean;
  preferenceOverlay?: MatrixCorpusStrictPreferenceOverlay;
  recordPreauthorizedCallStarted?: boolean;
  takePreauthorizedCall?(toolName: IntexAgentToolNameV1):
    | ReturnType<DecodedStrictToolMockProfile['findCall']>
    | undefined;
}

export type MatrixCorpusStrictToolSelectionGateResult =
  | Readonly<{
      decision: 'allow';
      metadata: Readonly<{ turnIndex: number; ordinal: number }>;
    }>
  | Readonly<{
      decision: 'reject';
      category: 'behavioral_failure' | 'safety_stop';
      code: MatrixCorpusStrictToolMockErrorCode;
      metadata: Readonly<{ turnIndex: number; ordinal: number }>;
    }>;

export interface MatrixCorpusStrictToolMockBoundary {
  executor: IntexAgentToolExecutor;
  selectionGate: (input: Readonly<{
    toolName: IntexAgentToolNameV1;
    args: Record<string, unknown>;
  }>) => Promise<MatrixCorpusStrictToolSelectionGateResult>;
}

export function createStrictToolMockBoundary(
  input: Omit<CreateStrictToolMockExecutorInput, 'takePreauthorizedCall'>
): MatrixCorpusStrictToolMockBoundary {
  const ordinals = new Map<IntexAgentToolNameV1, number>();
  const authorizedCalls = new Map<
    IntexAgentToolNameV1,
    NonNullable<ReturnType<DecodedStrictToolMockProfile['findCall']>>[]
  >();
  const executor = createStrictToolMockExecutor({
    ...input,
    takePreauthorizedCall(toolName) {
      return authorizedCalls.get(toolName)?.shift();
    },
  });

  return {
    executor,
    selectionGate: async (selection): Promise<MatrixCorpusStrictToolSelectionGateResult> => {
      const ordinal = (ordinals.get(selection.toolName) ?? 0) + 1;
      ordinals.set(selection.toolName, ordinal);
      const previewCall = confirmationPreviewCall(input, selection.toolName);
      if (previewCall !== undefined) {
        return {
          decision: 'allow',
          metadata: { turnIndex: previewCall.turnIndex, ordinal: previewCall.ordinal },
        };
      }
      await input.recordToolCallStarted({
        toolName: selection.toolName,
        turnIndex: input.turnIndex,
        ordinal,
        facts: mapSafeToolFacts({
          toolName: selection.toolName,
          source: 'arguments',
          value: selection.args,
        }),
      });
      const expectedByCatalog = input.expectedByCatalog?.({
        toolName: selection.toolName,
        turnIndex: input.turnIndex,
        ordinal,
      });
      const decision = evaluateMatrixCorpusToolSelection({
        profile: input.profile,
        turnIndex: input.turnIndex,
        toolName: selection.toolName,
        ordinal,
        ...(expectedByCatalog !== undefined ? { expectedByCatalog } : {}),
      });
      const metadata = { turnIndex: input.turnIndex, ordinal } as const;
      if (decision.decision !== 'allow') {
        return {
          decision: 'reject',
          category: decision.decision,
          code: decision.code,
          metadata,
        };
      }
      const queue = authorizedCalls.get(selection.toolName) ?? [];
      queue.push(decision.call);
      authorizedCalls.set(selection.toolName, queue);
      return { decision: 'allow', metadata };
    },
  };
}

export function createStrictToolMockExecutor(
  input: CreateStrictToolMockExecutorInput
): IntexAgentToolExecutor {
  const ordinals = new Map<IntexAgentToolNameV1, number>();

  async function execute(
    toolName: IntexAgentToolNameV1,
    args: Record<string, unknown>
  ): Promise<string> {
    let ordinal: number;
    let call: NonNullable<ReturnType<DecodedStrictToolMockProfile['findCall']>>;
    if (input.takePreauthorizedCall !== undefined) {
      const preauthorized = input.takePreauthorizedCall(toolName);
      if (preauthorized === undefined) {
        throw new MatrixCorpusStrictToolMockError(
          'safety_stop',
          'MISSING_PREAUTHORIZED_SELECTION'
        );
      }
      ordinal = preauthorized.ordinal;
      call = preauthorized;
      if (input.recordPreauthorizedCallStarted === true) {
        await input.recordToolCallStarted({
          toolName,
          turnIndex: call.turnIndex,
          ordinal,
          facts: mapSafeToolFacts({ toolName, source: 'arguments', value: args }),
        });
      }
    } else {
      ordinal = (ordinals.get(toolName) ?? 0) + 1;
      ordinals.set(toolName, ordinal);
      await input.recordToolCallStarted({
        toolName,
        turnIndex: input.turnIndex,
        ordinal,
        facts: mapSafeToolFacts({ toolName, source: 'arguments', value: args }),
      });

      const expectedByCatalog = input.expectedByCatalog?.({
        toolName,
        turnIndex: input.turnIndex,
        ordinal,
      });
      const decision = evaluateMatrixCorpusToolSelection({
        profile: input.profile,
        turnIndex: input.turnIndex,
        toolName,
        ordinal,
        ...(expectedByCatalog !== undefined ? { expectedByCatalog } : {}),
      });
      if (decision.decision !== 'allow') {
        throw new MatrixCorpusStrictToolMockError(decision.decision, decision.code);
      }
      call = decision.call;
    }
    if (call.outcome.kind === 'failure') {
      throw new MatrixCorpusStrictToolMockError('configured_failure', call.outcome.code);
    }

    const configuredResult = structuredClone(call.outcome.result) as StrictMockResultV1;
    if (toolName === 'get_user_preferences') {
      const overlay = requirePreferenceOverlay(input.preferenceOverlay);
      const actual = await overlay.read({
        ingestReceiptId: input.ingestReceiptId,
        toolName,
        turnIndex: input.turnIndex,
        ordinal,
        configuredResult,
      });
      return encodePreferenceOverlayReadResult(actual);
    }
    if (isPreferenceMutationTool(toolName)) {
      const overlay = requirePreferenceOverlay(input.preferenceOverlay);
      const actual = await overlay.mutate({
        ingestReceiptId: input.ingestReceiptId,
        mutationReceipt: matrixCorpusPreferenceMutationReceipt(
          input.ingestReceiptId,
          toolName,
          input.turnIndex,
          ordinal
        ),
        toolName,
        turnIndex: input.turnIndex,
        ordinal,
        args: args as unknown as PreferenceMutationArgs,
        configuredResult,
      });
      return encodeMatchingOverlayResult(actual, configuredResult);
    }

    return JSON.stringify(configuredResult);
  }

  return {
    async createNote(args: CreateNoteToolArgs): Promise<string> {
      return await execute('create_note', toRecord(args));
    },
    async createCalendarEvent(args: CreateCalendarEventToolArgs): Promise<string> {
      return await execute('create_calendar_event', toRecord(args));
    },
    async updateCalendarEvent(args: UpdateCalendarEventToolArgs): Promise<string> {
      if (!hasCompleteCalendarUpdateSnapshot(args)) {
        throw new MatrixCorpusStrictToolMockError(
          'safety_stop',
          'MISSING_CALENDAR_EVENT_SNAPSHOT'
        );
      }
      return await execute('update_calendar_event', toRecord(args));
    },
    async queryCalendarEvents(args: QueryCalendarEventsToolArgs): Promise<string> {
      return await execute('query_calendar_events', toRecord(args));
    },
    async createResearch(args: CreateResearchToolArgs): Promise<string> {
      return await execute('create_research', toRecord(args));
    },
    async createLink(args: CreateLinkToolArgs): Promise<string> {
      return await execute('create_link', toRecord(args));
    },
    async createCodeTask(args: CreateCodeTaskToolArgs): Promise<string> {
      return await execute('create_code_task', toRecord(args));
    },
    async saveExternal(args: SaveExternalToolArgs): Promise<string> {
      return await execute('save_external', toRecord(args));
    },
    async getUserPreferences(): Promise<string> {
      return await execute('get_user_preferences', {});
    },
    async addUserPreference(args: AddUserPreferenceToolArgs): Promise<string> {
      return await execute('add_user_preference', toRecord(args));
    },
    async updateUserPreference(args: UpdateUserPreferenceToolArgs): Promise<string> {
      return await execute('update_user_preference', toRecord(args));
    },
    async deleteUserPreference(args: DeleteUserPreferenceToolArgs): Promise<string> {
      return await execute('delete_user_preference', toRecord(args));
    },
  };
}

function confirmationPreviewCall(
  input: Omit<CreateStrictToolMockExecutorInput, 'takePreauthorizedCall'>,
  toolName: IntexAgentToolNameV1
): NonNullable<ReturnType<DecodedStrictToolMockProfile['findCall']>> | undefined {
  if (!CONFIRMATION_MUTATION_TOOL_NAMES.has(toolName)) return undefined;
  const futureCandidates = input.profile.profile.calls.filter(
    (call) =>
      call.toolName === toolName &&
      call.turnIndex > input.turnIndex &&
      (toolName === 'create_calendar_event' || call.turnIndex === input.turnIndex + 1)
  );
  const nearestTurn = Math.min(...futureCandidates.map(({ turnIndex }) => turnIndex));
  const candidates = futureCandidates.filter((call) => call.turnIndex === nearestTurn);
  if (candidates.length !== 1) return undefined;
  const candidate = candidates[0];
  /* v8 ignore start -- ts-type: length check above guarantees index zero is defined; this guard exists only for noUncheckedIndexedAccess narrowing @preserve */
  if (candidate === undefined) return undefined;
  /* v8 ignore stop @preserve */
  if (
    input.expectedByCatalog?.({
      toolName,
      turnIndex: candidate.turnIndex,
      ordinal: candidate.ordinal,
    }) === false
  )
    return undefined;
  return candidate;
}

function requirePreferenceOverlay(
  overlay: MatrixCorpusStrictPreferenceOverlay | undefined
): MatrixCorpusStrictPreferenceOverlay {
  if (overlay === undefined) {
    throw new MatrixCorpusStrictToolMockError('safety_stop', 'MISSING_PREFERENCE_OVERLAY');
  }
  return overlay;
}

function encodeMatchingOverlayResult(
  actual: StrictMockResultV1,
  expected: StrictMockResultV1
): string {
  if (stableJson(actual) !== stableJson(expected)) {
    throw new MatrixCorpusStrictToolMockError(
      'safety_stop',
      'PREFERENCE_OVERLAY_RESULT_MISMATCH'
    );
  }
  return JSON.stringify(expected);
}

function encodePreferenceOverlayReadResult(actual: StrictMockResultV1): string {
  const parsed = strictMockResultV1Schema.safeParse(actual);
  if (!parsed.success || parsed.data.toolName !== 'get_user_preferences') {
    throw new MatrixCorpusStrictToolMockError(
      'safety_stop',
      'PREFERENCE_OVERLAY_RESULT_MISMATCH'
    );
  }
  return JSON.stringify(parsed.data);
}

export function matrixCorpusPreferenceMutationReceipt(
  ingestReceiptId: string,
  toolName: PreferenceMutationToolName,
  turnIndex: number,
  ordinal: number
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        domain: 'matrix-corpus-preference-overlay-mutation-v1',
        ingestReceiptId,
        ordinal,
        toolName,
        turnIndex,
      }),
      'utf8'
    )
    .digest('hex');
}

function hasCompleteCalendarUpdateSnapshot(args: UpdateCalendarEventToolArgs): boolean {
  return (
    typeof args.calendarId === 'string' &&
    args.calendarId.trim() !== '' &&
    typeof args.expectedEtag === 'string' &&
    args.expectedEtag.trim() !== '' &&
    args.eventStart !== undefined &&
    args.eventEnd !== undefined
  );
}

function isPreferenceMutationTool(
  toolName: IntexAgentToolNameV1
): toolName is PreferenceMutationToolName {
  return (
    toolName === 'add_user_preference' ||
    toolName === 'update_user_preference' ||
    toolName === 'delete_user_preference'
  );
}

function toRecord(value: object): Record<string, unknown> {
  return value as unknown as Record<string, unknown>;
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, sortValue(nested)])
  );
}
