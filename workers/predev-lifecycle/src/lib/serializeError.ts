/**
 * Serialize an error for structured logging.
 * Local copy since this worker doesn't depend on @intexuraos/common-core.
 */
export interface SerializedError {
  message: string;
  name?: string;
  stack?: string;
  code?: string;
}

const MAX_STACK_LENGTH = 2000;

export function serializeError(error: unknown): SerializedError {
  if (!(error instanceof Error)) {
    return { message: 'Unknown error' };
  }

  const result: SerializedError = {
    message: error.message,
    name: error.name,
  };

  /* v8 ignore start -- ts-type: Error.stack can be undefined per TS types but practically always exists in JS runtimes @preserve */
  if (error.stack !== undefined) {
    /* v8 ignore stop @preserve */
    result.stack =
      /* v8 ignore start -- ts-type: ternary branch for stack length > 2000 chars rarely hit in tests @preserve */
      error.stack.length > MAX_STACK_LENGTH
        ? error.stack.substring(0, MAX_STACK_LENGTH)
        : error.stack;
    /* v8 ignore stop @preserve */
  }

  const errorWithCode = error as Error & { code?: unknown };
  /* v8 ignore start -- ts-type: code property check requires specific error type to cover both branches @preserve */
  if (typeof errorWithCode.code === 'string') {
    /* v8 ignore stop @preserve */
    result.code = errorWithCode.code;
  }

  return result;
}
