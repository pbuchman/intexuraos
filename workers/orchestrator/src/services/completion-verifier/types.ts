import type { CompletionAgentType } from './schemas.js';
import type { WorkerType } from '../isolation/types.js';
import type { ExecutionMemoryPromptContext } from '../../types/execution-memory.js';

/** Input to the synchronous completion verifier. */
export interface CompletionVerifierInput {
  transcript: string;
  agentType: CompletionAgentType;
  workerType: WorkerType;
  executionMemoryContext: ExecutionMemoryPromptContext | undefined; // @allow-undefined-type -- positional optional, undefined means "no memory injected"
  /** Docker worker exit code; 137/139 short-circuit to hard-error. */
  lastExitCode: number | undefined; // @allow-undefined-type -- positional optional
}

/** Discriminated verdict returned by verifyCompletion. */
export type CompletionVerifierVerdict =
  | {
      kind: 'parsed';
      data: Record<string, unknown>;
      missingRequired: string[];
      telemetryMissing: string[];
      warnings: string[];
    }
  | {
      kind: 'hard-error';
      code: 'TASK_RUNTIME_HARD_ERROR';
      message: string;
    };

// No verifier-LLM failure mode anymore; the verifier is pure.
