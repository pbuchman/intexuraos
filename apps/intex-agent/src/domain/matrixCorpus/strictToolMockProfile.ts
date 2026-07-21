import { createHash, timingSafeEqual } from 'node:crypto';

import {
  canonicalMatrixCorpusStrictToolMockProfileV1,
  intexAgentToolNameV1Schema,
  strictToolMockProfileV1Schema,
  type IntexAgentToolNameV1,
  type StrictToolMockProfileV1,
} from '@intexuraos/http-contracts';

const SHA_256_PATTERN = /^[0-9a-f]{64}$/u;

export const MATRIX_CORPUS_CANONICAL_TOOL_NAMES = Object.freeze([
  ...intexAgentToolNameV1Schema.options,
]);

export interface MatrixCorpusMockScheduleKey {
  turnIndex: number;
  toolName: IntexAgentToolNameV1;
  ordinal: number;
}

type StrictMockCall = StrictToolMockProfileV1['calls'][number];

export interface DecodedStrictToolMockProfile {
  readonly profile: DeepReadonly<StrictToolMockProfileV1>;
  readonly digest: string;
  findCall(input: MatrixCorpusMockScheduleKey): DeepReadonly<StrictMockCall> | undefined;
  callsFor(
    turnIndex: number,
    toolName: IntexAgentToolNameV1
  ): readonly DeepReadonly<StrictMockCall>[];
}

export type StrictToolMockProfileDecodeFailureCode =
  | 'INVALID_PROFILE'
  | 'DIGEST_MISMATCH'
  | 'MISSING_SCHEDULE_ENTRY'
  | 'UNEXPECTED_SCHEDULE_ENTRY';

export type StrictToolMockProfileDecodeResult =
  | (Readonly<{ ok: true }> & DecodedStrictToolMockProfile)
  | Readonly<{ ok: false; code: StrictToolMockProfileDecodeFailureCode }>;

export interface DecodeStrictToolMockProfileInput {
  profile: unknown;
  expectedDigest: string;
  expectedSchedule: readonly MatrixCorpusMockScheduleKey[];
}

export function decodeStrictToolMockProfile(
  input: DecodeStrictToolMockProfileInput
): StrictToolMockProfileDecodeResult {
  const parsed = strictToolMockProfileV1Schema.safeParse(input.profile);
  if (!parsed.success || !SHA_256_PATTERN.test(input.expectedDigest)) {
    return { ok: false, code: 'INVALID_PROFILE' };
  }

  let canonical: string;
  try {
    canonical = canonicalMatrixCorpusStrictToolMockProfileV1(parsed.data);
  } catch {
    return { ok: false, code: 'INVALID_PROFILE' };
  }
  const actualDigest = createHash('sha256').update(canonical, 'utf8').digest('hex');
  if (!equalDigest(actualDigest, input.expectedDigest)) {
    return { ok: false, code: 'DIGEST_MISMATCH' };
  }

  const actualKeys = new Set(parsed.data.calls.map(scheduleKey));
  const expectedKeys = new Set(input.expectedSchedule.map(scheduleKey));
  if ([...actualKeys].some((key) => !expectedKeys.has(key))) {
    return { ok: false, code: 'UNEXPECTED_SCHEDULE_ENTRY' };
  }
  if ([...expectedKeys].some((key) => !actualKeys.has(key))) {
    return { ok: false, code: 'MISSING_SCHEDULE_ENTRY' };
  }

  const frozenProfile = deepFreeze(structuredClone(parsed.data));
  const callsByKey = new Map<string, DeepReadonly<StrictMockCall>>();
  const callsByToolAndTurn = new Map<string, DeepReadonly<StrictMockCall>[]>();
  for (const call of frozenProfile.calls) {
    callsByKey.set(scheduleKey(call), call);
    const groupKey = toolAndTurnKey(call.turnIndex, call.toolName);
    const group = callsByToolAndTurn.get(groupKey) ?? [];
    group.push(call);
    callsByToolAndTurn.set(groupKey, group);
  }
  for (const group of callsByToolAndTurn.values()) {
    group.sort((left, right) => left.ordinal - right.ordinal);
    Object.freeze(group);
  }

  const decoded: DecodedStrictToolMockProfile = Object.freeze({
    profile: frozenProfile,
    digest: actualDigest,
    findCall(key: MatrixCorpusMockScheduleKey): DeepReadonly<StrictMockCall> | undefined {
      return callsByKey.get(scheduleKey(key));
    },
    callsFor(
      turnIndex: number,
      toolName: IntexAgentToolNameV1
    ): readonly DeepReadonly<StrictMockCall>[] {
      return callsByToolAndTurn.get(toolAndTurnKey(turnIndex, toolName)) ?? [];
    },
  });

  return { ok: true, ...decoded };
}

function scheduleKey(input: MatrixCorpusMockScheduleKey): string {
  return `${String(input.turnIndex)}:${input.toolName}:${String(input.ordinal)}`;
}

function toolAndTurnKey(turnIndex: number, toolName: IntexAgentToolNameV1): string {
  return `${String(turnIndex)}:${toolName}`;
}

function equalDigest(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'hex');
  const rightBytes = Buffer.from(right, 'hex');
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) {
      deepFreeze(nested);
    }
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}
