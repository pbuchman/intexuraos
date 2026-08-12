/**
 * Default configuration constants for the orchestrator bootstrap.
 *
 * Centralized here so bootstrap modules can share defaults without
 * duplicating literals. Overridable via environment variables where noted.
 */

/** Default HTTP port the orchestrator listens on. Override: `PORT`. */
export const DEFAULT_PORT = 8199;

/** Default number of concurrent worker slots. Override: `INTEXURAOS_WORKER_CAPACITY`. */
export const DEFAULT_CAPACITY = 2;

/** Default per-task timeout (1 hour). */
export const DEFAULT_TASK_TIMEOUT_MS = 60 * 60 * 1000;

/**
 * Timeout for external commands (e.g. `gcloud`). Longer than most CLI calls
 * because `gcloud` is slow under systemd sandboxing.
 */
export const EXEC_TIMEOUT_MS = 60 * 1000;

/**
 * Default maximum number of completion-verification attempts.
 * Override: `INTEXURAOS_COMPLETION_MAX_ATTEMPTS`.
 */
export const DEFAULT_COMPLETION_MAX_ATTEMPTS = 3;

/**
 * Default worker Docker image. Override: `INTEXURAOS_CODE_WORKER_IMAGE`.
 */
export const DEFAULT_WORKER_IMAGE =
  'europe-central2-docker.pkg.dev/intexuraos-dev-pbuchman/intexuraos-dev/code-worker:latest';

/**
 * Default ordered list of validation models used by the completion verifier and
 * compliance validator. Override: `INTEXURAOS_ORCHESTRATOR_VALIDATION_MODELS`.
 */
export const DEFAULT_VALIDATION_MODELS = 'or:google/gemma-4-31b-it,or:deepseek/deepseek-v4-flash';
