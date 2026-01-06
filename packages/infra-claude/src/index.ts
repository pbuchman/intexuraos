export { createClaudeClient, type ClaudeClient } from './client.js';
export { createClaudeClientV2, type ClaudeClientV2 } from './clientV2.js';
export { calculateTextCost, normalizeUsageV2 } from './costCalculator.js';
export type {
  ClaudeConfig,
  ClaudeConfigV2,
  ClaudeError,
  ResearchResult,
  GenerateResult,
  SynthesisInput,
} from './types.js';
