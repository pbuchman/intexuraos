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

function parseGeminiError(raw: string): FormattedError | null {
  // Gemini errors often come as JSON strings
  if (!raw.includes('"error"') || !raw.includes('"message"')) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as {
      error?: {
        code?: number;
        message?: string;
        status?: string;
        details?: {
          '@type'?: string;
          retryDelay?: string;
          violations?: { quotaMetric?: string; quotaValue?: string }[];
        }[];
      };
    };

    if (parsed.error === undefined) {
      return null;
    }

    const { code, message, status, details } = parsed.error;

    // Extract retry delay if present
    const retryInfo = details?.find((d) => d['@type']?.includes('RetryInfo') === true);
    const retryIn = retryInfo?.retryDelay;

    // Extract quota info if present
    const quotaInfo = details?.find((d) => d['@type']?.includes('QuotaFailure') === true);
    const quotaViolation = quotaInfo?.violations?.[0];

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

    // Generic Gemini error
    return {
      title: status ?? `Error ${String(code ?? '')}`,
      detail:
        message !== undefined && message.length < 100
          ? message
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
