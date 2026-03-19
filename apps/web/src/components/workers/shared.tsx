import type { CodeTaskWorkerType } from '@intexuraos/common-core/code-task-worker-types';

export const WORKER_TYPE_METADATA: Record<CodeTaskWorkerType, { name: string; description: string }> = {
  auto: { name: 'Auto', description: 'Automatically select the best available model for the task' },
  opus: { name: 'Opus', description: 'Anthropic\'s most capable model for complex reasoning and coding tasks' },
  sonnet: { name: 'Sonnet', description: 'Anthropic\'s daily coding model with the best balance of speed and intelligence' },
  minimax: { name: 'MiniMax', description: 'MiniMax\'s coding and agent model with strong reasoning at lower cost' },
  glm: { name: 'GLM', description: 'Zhipu\'s flagship Agentic Engineering model for complex systems and long-running agent tasks' },
  qwen: { name: 'Qwen', description: 'Advanced Qwen model with thinking enabled' },
  kimi: { name: 'Kimi', description: 'Moonshot\'s latest recommended model with image understanding' },
};
