/**
 * Logger interface for domain use cases.
 */
export interface Logger {
  info(data: Record<string, unknown>, message: string): void;
  error(data: Record<string, unknown>, message: string): void;
}

export const LOGGER_METHOD_NAMES = ['info', 'error'] as const;
