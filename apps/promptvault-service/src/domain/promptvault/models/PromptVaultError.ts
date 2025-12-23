/**
 * PromptVault domain error types.
 */

/**
 * Error codes for PromptVault operations.
 */
export type PromptVaultErrorCode =
  | 'NOT_FOUND'
  | 'NOT_CONNECTED'
  | 'UNAUTHORIZED'
  | 'VALIDATION_ERROR'
  | 'DOWNSTREAM_ERROR'
  | 'INTERNAL_ERROR';

/**
 * Domain error for PromptVault operations.
 */
export interface PromptVaultError {
  code: PromptVaultErrorCode;
  message: string;
  cause?: unknown;
}

/**
 * Create a PromptVaultError.
 */
export function createPromptVaultError(
  code: PromptVaultErrorCode,
  message: string,
  cause?: unknown
): PromptVaultError {
  return { code, message, cause };
}
