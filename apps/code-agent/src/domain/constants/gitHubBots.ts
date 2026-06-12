/**
 * Allow-list of GitHub bot logins whose webhook events should trigger automation.
 *
 * Lives in `domain/constants` so both the webhook route, the use case that
 * processes webhook deliveries, and service wiring in `services.ts` can import
 * it without coupling to route-layer code.
 */
export const ALLOWED_BOTS = new Set([
  'claude[bot]',
  'chatgpt-codex-connector[bot]',
  'intexuraos-code-worker[bot]',
]);

/**
 * Subset of ALLOWED_BOTS that represent the code worker — used by rules that
 * treat code-worker output specially (e.g., not dispatching back on its own
 * comments).
 */
export const CODE_WORKER_BOTS = new Set([
  'intexuraos-code-worker[bot]',
]);
