import { WORKER_TYPES, type WorkerType } from '../isolation/types.js';
import { claudeRuntime } from './claude-runtime.js';
import { codexRuntime } from './codex-runtime.js';
import type { RuntimeAdapter, WorkerRuntime } from './types.js';

const RUNTIME_REGISTRY: Record<WorkerRuntime, RuntimeAdapter> = {
  claude: claudeRuntime,
  codex: codexRuntime,
};

export function getRuntime(name: WorkerRuntime): RuntimeAdapter {
  return RUNTIME_REGISTRY[name];
}

export function getRuntimeForWorkerType(workerType: WorkerType): RuntimeAdapter {
  return getRuntime(WORKER_TYPES[workerType].runtime);
}

export { claudeRuntime } from './claude-runtime.js';
export { codexRuntime } from './codex-runtime.js';
export type { RuntimeAdapter, RuntimeAttemptState, RuntimeEvent, WorkerRuntime } from './types.js';
