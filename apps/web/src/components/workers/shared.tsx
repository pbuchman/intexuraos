import type { CodeTaskWorkerType } from '@intexuraos/code-task-domain/worker-types';

export const WORKER_TYPE_METADATA: Record<CodeTaskWorkerType, { name: string; description: string }> = {
  auto: { name: 'Claude Auto', description: 'Claude Code selects the model using Claude OAuth' },
  opus: { name: 'Opus', description: 'Anthropic\'s most capable model for complex reasoning and coding tasks' },
  sonnet: { name: 'Sonnet', description: 'Anthropic\'s daily coding model with the best balance of speed and intelligence' },
  codex: { name: 'Codex', description: 'OpenAI Codex runtime for code-task execution with persisted thread resume' },
  'codex-xhigh': { name: 'Codex XHigh', description: 'High-effort Codex preset for deeper reviews, investigations, and complex implementation tasks' },
  'openrouter-free': { name: 'OpenRouter Free', description: 'Free-tier code worker routed only through OpenRouter' },
};

export const WORKER_TYPE_LABELS: Record<CodeTaskWorkerType, string> = Object.fromEntries(
  Object.entries(WORKER_TYPE_METADATA).map(([workerType, metadata]) => [workerType, metadata.name])
) as Record<CodeTaskWorkerType, string>;
