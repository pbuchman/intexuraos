/**
 * Shared mapper for endpoints that do no method-level logging.
 *
 * `fetchIssueTree`, `fetchDirectChildrenLive`, and `updateIssueMetadata` use
 * the same silent error policy: 404 → NOT_FOUND, other HTTP failures →
 * UNAVAILABLE, everything else → UNKNOWN. They only differ in the success
 * branch, which callers handle after narrowing via `isOk`.
 *
 * Logging endpoints (`createIssue`, `validateIssue`, `addComment`, etc.) map
 * inline because their log level and error code vary per HTTP status.
 */

import type { Result } from '@intexuraos/common-core';
import { err, getErrorMessage } from '@intexuraos/common-core';
import type { LinearAgentError } from '../../../domain/ports/linearAgentClient.js';
import type { LinearFetchResult } from './linear-fetch-util.js';

/** Type guard narrowing a LinearFetchResult to its `ok` branch. */
export function isOk<T>(
  result: LinearFetchResult<T>,
): result is { kind: 'ok'; data: T } {
  return result.kind === 'ok';
}

/**
 * Maps any non-ok LinearFetchResult kind to the silent error policy above.
 * Callers must narrow with `isOk` before invoking (enforced by type).
 */
export function mapSilentFetchError<T>(
  result: Exclude<LinearFetchResult<T>, { kind: 'ok' }>,
): Result<never, LinearAgentError> {
  if (result.kind === 'http-error') {
    return err({
      code: result.status === 404 ? 'NOT_FOUND' : 'UNAVAILABLE',
      message: result.errorText,
    });
  }

  if (result.kind === 'invalid-body') {
    return err({ code: 'UNKNOWN', message: 'Invalid response from linear-agent' });
  }

  if (result.kind === 'timeout') {
    return err({ code: 'UNKNOWN', message: 'Request timed out' });
  }

  return err({ code: 'UNKNOWN', message: getErrorMessage(result.error) });
}
