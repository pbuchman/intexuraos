import type { Logger } from '@intexuraos/common-core';

export type WorkerRuntime = 'claude' | 'codex';

export interface RuntimeAttemptState {
  taskId: string;
  logger: Logger;
}

export type RuntimeEvent =
  | { type: 'log'; text: string }
  | { type: 'runtime_session_started'; sessionId: string }
  | { type: 'attempt_completed'; exitCode: number }
  | { type: 'attempt_failed'; exitCode: number; errorMessage: string };

export interface RuntimeAdapter<TState extends RuntimeAttemptState = RuntimeAttemptState> {
  readonly runtime: WorkerRuntime;
  createAttemptState(taskId: string, logger: Logger): TState;
  processLogChunk(state: TState, chunk: string): RuntimeEvent[];
  flushAttemptState(state: TState): RuntimeEvent[];
}

export interface RuntimeLogProcessor<TState extends RuntimeAttemptState = RuntimeAttemptState> {
  processChunk(state: TState, chunk: string): RuntimeEvent[];
  flushState(state: TState): RuntimeEvent[];
}
