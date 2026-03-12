export const CODE_TASK_WORKER_TYPES = [
  'auto',
  'opus',
  'sonnet',
  'minimax',
  'glm',
  'qwen',
  'kimi',
] as const;

export type CodeTaskWorkerType = (typeof CODE_TASK_WORKER_TYPES)[number];

const CODE_TASK_WORKER_TYPE_SET = new Set<string>(CODE_TASK_WORKER_TYPES);

export function isCodeTaskWorkerType(value: string): value is CodeTaskWorkerType {
  return CODE_TASK_WORKER_TYPE_SET.has(value);
}
