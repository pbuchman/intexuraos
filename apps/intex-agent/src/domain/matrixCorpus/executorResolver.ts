import type { IntexAgentToolExecutor } from '../agent/toolDefinitions.js';
import type {
  MatrixCorpusLlmCallContextV1,
  MatrixCorpusProviderCallUsageV1,
} from '@intexuraos/llm-contract';
import type { IntexAgentSession } from '../sessions/types.js';
import type {
  CreateStrictToolMockExecutorInput,
  MatrixCorpusStrictPreferenceOverlay,
  MatrixCorpusStrictToolSelectionRecord,
} from './strictToolMockExecutor.js';
import {
  decodeStrictToolMockProfile,
  type MatrixCorpusMockScheduleKey,
} from './strictToolMockProfile.js';

export type MatrixCorpusExecutionFlow = 'normal' | 'confirmation';
export type MatrixCorpusExecutionBoundaryResolution =
  | 'strict_mock_executor_resolved'
  | 'no_executor_required';

export type MatrixCorpusPreauthorizedSelection = Readonly<{
  toolName: Parameters<NonNullable<CreateStrictToolMockExecutorInput['takePreauthorizedCall']>>[0];
  turnIndex: number;
  ordinal: number;
}>;

export interface MatrixCorpusExecutorExecutionContext {
  flow: MatrixCorpusExecutionFlow;
  turnIndex: number;
  ingestReceiptId: string;
  expectedSchedule: readonly MatrixCorpusMockScheduleKey[];
  recordExecutionBoundary: (resolution: MatrixCorpusExecutionBoundaryResolution) => Promise<void>;
  recordToolCallStarted: (input: MatrixCorpusStrictToolSelectionRecord) => Promise<void>;
  registerExpectedProviderCall: (input: MatrixCorpusLlmCallContextV1) => void;
  recordProviderCall: (input: MatrixCorpusProviderCallUsageV1) => Promise<void>;
  expectedByCatalog?: CreateStrictToolMockExecutorInput['expectedByCatalog'];
  preferenceOverlay?: MatrixCorpusStrictPreferenceOverlay;
  preauthorizedSelection?: MatrixCorpusPreauthorizedSelection;
  preauthorizedSelections?: readonly MatrixCorpusPreauthorizedSelection[];
}

export interface IntexAgentExecutorResolutionInput {
  session: IntexAgentSession;
  matrixCorpus?: MatrixCorpusExecutorExecutionContext;
}

export interface IntexAgentExecutorResolver {
  resolve: (input: IntexAgentExecutorResolutionInput) => IntexAgentToolExecutor;
}

export type MatrixCorpusExecutorResolutionErrorCode =
  | 'MISSING_MATRIX_EXECUTION_CONTEXT'
  | 'INVALID_MATRIX_MOCK_PROFILE'
  | 'INVALID_PREAUTHORIZED_SELECTION'
  | 'CROSS_LANE_EXECUTION_CONTEXT';

export class MatrixCorpusExecutorResolutionError extends Error {
  readonly code: MatrixCorpusExecutorResolutionErrorCode;

  constructor(code: MatrixCorpusExecutorResolutionErrorCode) {
    super(`Matrix corpus executor resolution failed: ${code}`);
    this.name = 'MatrixCorpusExecutorResolutionError';
    this.code = code;
  }
}

export interface CreateIntexAgentExecutorResolverInput {
  createOrdinaryExecutor: (session: IntexAgentSession) => IntexAgentToolExecutor;
  createMatrixCorpusExecutor: (
    input: CreateStrictToolMockExecutorInput &
      Readonly<{
        flow: MatrixCorpusExecutionFlow;
        preauthorizedSelection?: MatrixCorpusExecutorExecutionContext['preauthorizedSelection'];
        preauthorizedSelections?: MatrixCorpusExecutorExecutionContext['preauthorizedSelections'];
      }>
  ) => IntexAgentToolExecutor;
}

export function createIntexAgentExecutorResolver(
  dependencies: CreateIntexAgentExecutorResolverInput
): IntexAgentExecutorResolver {
  return {
    resolve: (input): IntexAgentToolExecutor => {
      const matrixProfile = input.session.matrixCorpusProfile;
      if (matrixProfile === undefined) {
        if (input.matrixCorpus !== undefined) {
          throw new MatrixCorpusExecutorResolutionError('CROSS_LANE_EXECUTION_CONTEXT');
        }
        return dependencies.createOrdinaryExecutor(input.session);
      }

      if (input.matrixCorpus === undefined) {
        throw new MatrixCorpusExecutorResolutionError('MISSING_MATRIX_EXECUTION_CONTEXT');
      }
      const decoded = decodeStrictToolMockProfile({
        profile: matrixProfile.mockProfile,
        expectedDigest: matrixProfile.mockProfileDigest,
        expectedSchedule: input.matrixCorpus.expectedSchedule,
      });
      if (!decoded.ok) {
        throw new MatrixCorpusExecutorResolutionError('INVALID_MATRIX_MOCK_PROFILE');
      }

      return dependencies.createMatrixCorpusExecutor({
        profile: decoded,
        flow: input.matrixCorpus.flow,
        turnIndex: input.matrixCorpus.turnIndex,
        ingestReceiptId: input.matrixCorpus.ingestReceiptId,
        recordToolCallStarted: input.matrixCorpus.recordToolCallStarted,
        ...(input.matrixCorpus.expectedByCatalog !== undefined
          ? { expectedByCatalog: input.matrixCorpus.expectedByCatalog }
          : {}),
        ...(input.matrixCorpus.preferenceOverlay !== undefined
          ? { preferenceOverlay: input.matrixCorpus.preferenceOverlay }
          : {}),
        ...(input.matrixCorpus.preauthorizedSelection !== undefined
          ? { preauthorizedSelection: input.matrixCorpus.preauthorizedSelection }
          : {}),
        ...(input.matrixCorpus.preauthorizedSelections !== undefined
          ? { preauthorizedSelections: input.matrixCorpus.preauthorizedSelections }
          : {}),
      });
    },
  };
}
