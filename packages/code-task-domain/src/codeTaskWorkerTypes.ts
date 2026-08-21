export const CODE_TASK_WORKER_TYPES = [
  'auto',
  'opus',
  'sonnet',
  'codex',
  'codex-xhigh',
  'openrouter-free',
] as const;

export type CodeTaskWorkerType = (typeof CODE_TASK_WORKER_TYPES)[number];

const CODE_TASK_WORKER_TYPE_SET = new Set<string>(CODE_TASK_WORKER_TYPES);

export function isCodeTaskWorkerType(value: string): value is CodeTaskWorkerType {
  return CODE_TASK_WORKER_TYPE_SET.has(value);
}

export type CodeTaskApiKeyEnvVar = 'OPENROUTER_API_KEY';

export type CodeTaskAuthRequirement =
  | { readonly kind: 'codex' }
  | { readonly kind: 'claude' }
  | { readonly kind: 'api_key'; readonly envVar: CodeTaskApiKeyEnvVar };

export interface CodeTaskWorkerCapability {
  readonly workerType: CodeTaskWorkerType;
  readonly displayName: string;
  readonly runtimeFamily: 'codex' | 'claude' | 'provider';
  readonly auth: CodeTaskAuthRequirement;
  readonly requiresDocker: boolean;
}

export const CODE_TASK_WORKER_CAPABILITIES: Record<CodeTaskWorkerType, CodeTaskWorkerCapability> = {
  auto: {
    workerType: 'auto',
    displayName: 'Claude Auto',
    runtimeFamily: 'claude',
    auth: { kind: 'claude' },
    requiresDocker: true,
  },
  opus: {
    workerType: 'opus',
    displayName: 'Claude Opus',
    runtimeFamily: 'claude',
    auth: { kind: 'claude' },
    requiresDocker: true,
  },
  sonnet: {
    workerType: 'sonnet',
    displayName: 'Claude Sonnet',
    runtimeFamily: 'claude',
    auth: { kind: 'claude' },
    requiresDocker: true,
  },
  codex: {
    workerType: 'codex',
    displayName: 'Codex',
    runtimeFamily: 'codex',
    auth: { kind: 'codex' },
    requiresDocker: true,
  },
  'codex-xhigh': {
    workerType: 'codex-xhigh',
    displayName: 'Codex xhigh',
    runtimeFamily: 'codex',
    auth: { kind: 'codex' },
    requiresDocker: true,
  },
  'openrouter-free': {
    workerType: 'openrouter-free',
    displayName: 'OpenRouter Free',
    runtimeFamily: 'provider',
    auth: { kind: 'api_key', envVar: 'OPENROUTER_API_KEY' },
    requiresDocker: true,
  },
};
