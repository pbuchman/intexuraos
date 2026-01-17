/**
 * Unified feedback contract for all service execution results.
 * Returned by all downstream services and propagated to the frontend.
 */
export interface ServiceFeedback {
  /** Execution outcome */
  status: 'completed' | 'failed';

  /** Human-readable message for user display (REQUIRED) */
  message: string;

  /** URL to the created/affected resource (success only) */
  resourceUrl?: string;

  /** Error code for debugging (REQUIRED when status === 'failed') */
  errorCode?: string;
}

/**
 * Type guard to check if feedback indicates success.
 */
export function isSuccessFeedback(
  feedback: ServiceFeedback
): feedback is ServiceFeedback & { status: 'completed' } {
  return feedback.status === 'completed';
}

/**
 * Type guard to check if feedback indicates failure.
 */
export function isFailureFeedback(
  feedback: ServiceFeedback
): feedback is ServiceFeedback & { status: 'failed'; errorCode: string } {
  return feedback.status === 'failed';
}

/**
 * Creates a success feedback response.
 */
export function successFeedback(message: string, resourceUrl?: string): ServiceFeedback {
  return {
    status: 'completed',
    message,
    ...(resourceUrl !== undefined && { resourceUrl }),
  };
}

/**
 * Creates a failure feedback response.
 */
export function failureFeedback(message: string, errorCode: string): ServiceFeedback {
  return {
    status: 'failed',
    message,
    errorCode,
  };
}
