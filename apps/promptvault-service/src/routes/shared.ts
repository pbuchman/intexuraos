import type { PromptVaultErrorCode } from '../domain/promptvault/index.js';

/**
 * Map domain error codes to HTTP error codes.
 */
export function mapDomainErrorCode(
  code: PromptVaultErrorCode
): 'NOT_FOUND' | 'MISCONFIGURED' | 'DOWNSTREAM_ERROR' | 'INVALID_REQUEST' | 'UNAUTHORIZED' {
  switch (code) {
    case 'NOT_FOUND':
      return 'NOT_FOUND';
    case 'NOT_CONNECTED':
      return 'MISCONFIGURED';
    case 'VALIDATION_ERROR':
      return 'INVALID_REQUEST';
    case 'UNAUTHORIZED':
      return 'UNAUTHORIZED';
    default:
      return 'DOWNSTREAM_ERROR';
  }
}
