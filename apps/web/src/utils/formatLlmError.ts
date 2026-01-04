/**
 * Format LLM API error messages for user-friendly display.
 * Parses raw error messages from OpenAI, Gemini, and Anthropic APIs.
 */

interface FormattedError {
  title: string;
  detail?: string;
  retryIn?: string;
}

/**
 * Parse and format an LLM error message for display.
 */
export function formatLlmError(rawError: string): FormattedError {
  // Try to parse as Gemini JSON error
  const geminiError = parseGeminiError(rawError);
  if (geminiError !== null) {
    return geminiError;
  }

  // Try to parse as OpenAI rate limit
  const openaiError = parseOpenaiRateLimit(rawError);
  if (openaiError !== null) {
    return openaiError;
  }

  // Try to parse as Anthropic error
  const anthropicError = parseAnthropicError(rawError);
  if (anthropicError !== null) {
    return anthropicError;
  }

  // Generic error handling
  return parseGenericError(rawError);
}

interface GoogleErrorDetail {
  '@type'?: string;
  retryDelay?: string;
  violations?: { quotaMetric?: string; quotaValue?: string }[];
  reason?: string;
  domain?: string;
  metadata?: Record<string, string>;
  locale?: string;
  message?: string;
}

interface GoogleError {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    details?: GoogleErrorDetail[];
  };
}

function parseGeminiError(raw: string): FormattedError | null {
  if (!raw.includes('"error"') || !raw.includes('"message"')) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as GoogleError;

    if (parsed.error === undefined) {
      return null;
    }

    const { code, message, status, details } = parsed.error;

    const retryInfo = details?.find((d) => d['@type']?.includes('RetryInfo') === true);
    const retryIn = retryInfo?.retryDelay;

    const quotaInfo = details?.find((d) => d['@type']?.includes('QuotaFailure') === true);
    const quotaViolation = quotaInfo?.violations?.[0];

    const errorInfo = details?.find((d) => d['@type']?.includes('ErrorInfo') === true);
    const localizedMessage = details?.find(
      (d) => d['@type']?.includes('LocalizedMessage') === true
    );

    const displayMessage = localizedMessage?.message ?? message;

    if (errorInfo?.reason === 'API_KEY_INVALID') {
      return {
        title: 'Invalid API key',
        detail: displayMessage ?? 'The API key is invalid or has expired',
      };
    }

    if (errorInfo?.reason === 'API_KEY_NOT_FOUND') {
      return {
        title: 'API key not found',
        detail: displayMessage ?? 'The API key does not exist',
      };
    }

    if (status === 'PERMISSION_DENIED' || code === 403) {
      return {
        title: 'Permission denied',
        detail: displayMessage ?? 'The API key lacks required permissions',
      };
    }

    if (status === 'RESOURCE_EXHAUSTED' || code === 429) {
      const result: FormattedError = {
        title: 'Rate limit exceeded',
        detail:
          quotaViolation !== undefined
            ? `Quota: ${quotaViolation.quotaValue ?? 'unknown'} tokens/min`
            : 'API quota temporarily exceeded',
      };
      if (retryIn !== undefined) {
        result.retryIn = `Retry in ${retryIn}`;
      }
      return result;
    }

    if (status === 'INVALID_ARGUMENT' || code === 400) {
      return {
        title: 'Invalid request',
        detail: displayMessage ?? 'The request was invalid',
      };
    }

    const statusLabel = status !== undefined ? status.replace(/_/g, ' ').toLowerCase() : null;
    const titleFromStatus =
      statusLabel !== null
        ? statusLabel.charAt(0).toUpperCase() + statusLabel.slice(1)
        : `Error ${String(code ?? '')}`;

    return {
      title: titleFromStatus,
      detail:
        displayMessage !== undefined && displayMessage.length < 150
          ? displayMessage
          : 'An error occurred with the Gemini API',
    };
  } catch {
    return null;
  }
}

function parseOpenaiRateLimit(raw: string): FormattedError | null {
  // OpenAI rate limit format: "429 Rate limit reached for X in organization Y on Z: Limit N, Used M, Requested P. Please try again in Xs."
  const rateLimitRegex =
    /429.*Rate limit.*on\s+(\w+[^:]*?):\s*Limit\s+(\d+),\s*Used\s+(\d+),\s*Requested\s+(\d+)\.\s*Please try again in\s+([\d.]+s)/i;
  const rateLimitMatch = rateLimitRegex.exec(raw);

  if (rateLimitMatch !== null) {
    const [, limitType, limit, used, requested, retryIn] = rateLimitMatch;
    return {
      title: 'Rate limit exceeded',
      detail: `${limitType ?? 'Tokens'}: ${used ?? '?'}/${limit ?? '?'} used, need ${requested ?? '?'} more`,
      retryIn: `Retry in ${retryIn ?? 'a moment'}`,
    };
  }

  // OpenAI quota exceeded format
  if (raw.includes('exceeded your current quota')) {
    return {
      title: 'Quota exceeded',
      detail: 'OpenAI API quota exceeded. Check billing.',
    };
  }

  // OpenAI context length
  if (raw.includes('context_length_exceeded') || raw.includes('maximum context length')) {
    return {
      title: 'Context too long',
      detail: "The request exceeds the model's context limit",
    };
  }

  return null;
}

function parseAnthropicError(raw: string): FormattedError | null {
  // Anthropic rate limit
  if (raw.includes('rate_limit') || (raw.includes('429') && raw.includes('anthropic'))) {
    return {
      title: 'Rate limit exceeded',
      detail: 'Anthropic API rate limit reached',
    };
  }

  // Anthropic overloaded
  if (raw.includes('overloaded')) {
    return {
      title: 'Service overloaded',
      detail: 'Anthropic API is temporarily overloaded',
    };
  }

  return null;
}

function parseGenericError(raw: string): FormattedError {
  // API key errors
  if (raw.toLowerCase().includes('api_key') || raw.toLowerCase().includes('invalid key')) {
    return {
      title: 'Invalid API key',
      detail: 'The API key for this provider is invalid or expired',
    };
  }

  // Timeout
  if (raw.toLowerCase().includes('timeout')) {
    return {
      title: 'Request timed out',
      detail: 'The API request took too long to respond',
    };
  }

  // Connection errors
  if (raw.toLowerCase().includes('network') || raw.toLowerCase().includes('connection')) {
    return {
      title: 'Connection error',
      detail: 'Could not connect to the API',
    };
  }

  // If the error is very long (likely raw JSON), truncate it
  if (raw.length > 100) {
    return {
      title: 'API error',
      detail: raw.slice(0, 80) + '...',
    };
  }

  return {
    title: raw,
  };
}

/**
 * Render formatted error as a single string (for simple display).
 */
export function formatLlmErrorString(rawError: string): string {
  const formatted = formatLlmError(rawError);
  const parts = [formatted.title];
  if (formatted.detail !== undefined) {
    parts.push(formatted.detail);
  }
  if (formatted.retryIn !== undefined) {
    parts.push(formatted.retryIn);
  }
  return parts.join(' — ');
}
