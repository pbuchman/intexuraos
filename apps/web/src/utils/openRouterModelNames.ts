/**
 * Static mapping of OpenRouter model IDs to human-readable names.
 *
 * Mirrors the curated allowlist in packages/infra-openrouter/src/allowlist.ts.
 * When a model ID is not found in this mapping, the raw ID is returned as-is.
 */

const OPENROUTER_MODEL_NAMES: Record<string, string> = {
  'qwen/qwen3.5-plus-02-15': 'Qwen 3.5 Plus',
  'qwen/qwen3.5-flash-02-23': 'Qwen 3.5 Flash',
  'minimax/minimax-m2.7': 'MiniMax M2.7',
  'x-ai/grok-4.20-beta': 'Grok 4.20 Beta',
  'x-ai/grok-4.1-fast': 'Grok 4.1 Fast',
  'moonshotai/kimi-k2.5': 'Kimi K2.5',
  'anthropic/claude-sonnet-4.6': 'Claude Sonnet 4.6',
  'anthropic/claude-opus-4.6': 'Claude Opus 4.6',
  'google/gemini-3.1-pro-preview': 'Gemini 3.1 Pro',
  'google/gemini-2.5-flash': 'Gemini 2.5 Flash',
  'openai/gpt-5.4': 'GPT-5.4',
  'openai/gpt-5.4-mini': 'GPT-5.4 Mini',
  'xiaomi/mimo-v2-pro': 'MiMo V2 Pro',
  'z-ai/glm-5-turbo': 'GLM 5 Turbo',
};

/**
 * Resolve an OpenRouter model ID to its human-readable name.
 * Strips the `:online` suffix before lookup (OpenRouter appends it for web-search mode).
 * Returns the raw model ID if no friendly name is found.
 */
export function resolveOpenRouterModelName(modelId: string): string {
  const baseId = modelId.endsWith(':online') ? modelId.slice(0, -7) : modelId;
  return OPENROUTER_MODEL_NAMES[baseId] ?? modelId;
}
