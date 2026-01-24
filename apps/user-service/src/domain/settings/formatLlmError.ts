/**
 * Format LLM API error messages for storage.
 * Extracts user-friendly message from provider-specific error formats.
 */

interface GoogleErrorDetail {
  '@type'?: string;
  violations?: { quotaMetric?: string; quotaValue?: string }[];
  reason?: string;
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

interface AnthropicError {
  type: 'error';
  error: {
    type: string;
    message: string;
  };
}

function isAnthropicError(parsed: unknown): parsed is AnthropicError {
  return (
    typeof parsed === 'object' &&
    parsed !== null &&
    'type' in parsed &&
    parsed.type === 'error' &&
    'error' in parsed &&
    typeof parsed.error === 'object' &&
    parsed.error !== null &&
    'type' in parsed.error &&
    'message' in parsed.error
  );
}

/**
 * Extract user-friendly error message from raw LLM error.
 */
export function formatLlmError(rawError: string): string {
  const gemini = tryParseGeminiError(rawError);
  if (gemini !== null) {
    return gemini;
  }

  const openai = tryParseOpenaiError(rawError);
  if (openai !== null) {
    return openai;
  }

  const anthropic = tryParseAnthropicError(rawError);
  if (anthropic !== null) {
    return anthropic;
  }

  return parseGenericError(rawError);
}

function tryParseGeminiError(raw: string): string | null {
  if (!raw.includes('"error"') || !raw.includes('"message"')) {
    return null;
  }

  if (raw.includes('"type":"error"') || raw.includes('"type": "error"')) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as GoogleError;

    if (parsed.error === undefined) {
      return null;
    }

    const { code, message, status, details } = parsed.error;

    const errorInfo = details?.find((d) => d['@type']?.includes('ErrorInfo') === true);
    const localizedMessage = details?.find(
      (d) => d['@type']?.includes('LocalizedMessage') === true
    );

    const displayMessage = localizedMessage?.message ?? message;

    if (errorInfo?.reason === 'API_KEY_INVALID') {
      return displayMessage !== undefined && displayMessage.length > 0
        ? displayMessage
        : 'The API key is invalid or has expired';
    }

    if (errorInfo?.reason === 'API_KEY_NOT_FOUND') {
      return displayMessage !== undefined && displayMessage.length > 0
        ? displayMessage
        : 'The API key does not exist';
    }

    if (status === 'PERMISSION_DENIED' || code === 403) {
      return displayMessage !== undefined && displayMessage.length > 0
        ? displayMessage
        : 'The API key lacks required permissions';
    }

    if (status === 'RESOURCE_EXHAUSTED' || code === 429) {
      const quotaInfo = details?.find((d) => d['@type']?.includes('QuotaFailure') === true);
      const quotaViolation = quotaInfo?.violations?.[0];
      return quotaViolation !== undefined
        ? `Quota: ${quotaViolation.quotaValue ?? 'unknown'} tokens/min`
        : 'API quota temporarily exceeded';
    }

    if (status === 'INVALID_ARGUMENT' || code === 400) {
      return displayMessage !== undefined && displayMessage.length > 0
        ? displayMessage
        : 'The request was invalid';
    }

    if (displayMessage !== undefined && displayMessage.length < 150) {
      return displayMessage;
    }

    return 'An error occurred with the Gemini API';
  } catch {
    return null;
  }
}

function tryParseOpenaiError(raw: string): string | null {
  const rateLimitRegex =
    /429.*Rate limit.*on\s+(\w+[^:]*?):\s*Limit\s+(\d+),\s*Used\s+(\d+),\s*Requested\s+(\d+)\./i;
  const rateLimitMatch = rateLimitRegex.exec(raw);

  if (rateLimitMatch !== null) {
    const [, limitType, limit, used, requested] = rateLimitMatch;
    return `${limitType ?? 'Tokens'}: ${used ?? '?'}/${limit ?? '?'} used, need ${requested ?? '?'} more`;
  }

  if (raw.includes('exceeded your current quota')) {
    return 'OpenAI API quota exceeded. Check billing.';
  }

  if (raw.includes('context_length_exceeded') || raw.includes('maximum context length')) {
    return "The request exceeds the model's context limit";
  }

  return null;
}

function tryParseAnthropicError(raw: string): string | null {
  // Check for credit balance billing error first (most specific pattern)
  if (raw.includes('credit balance') || raw.includes('credit_balance')) {
    return 'Insufficient Anthropic API credits. Please add funds at console.anthropic.com';
  }

  const jsonMatch = /\{[\s\S]*"type"\s*:\s*"error"[\s\S]*\}/.exec(raw);
  if (jsonMatch !== null) {
    try {
      const parsed: unknown = JSON.parse(jsonMatch[0]);
      if (isAnthropicError(parsed)) {
        const { message } = parsed.error;
        // Double-check parsed message for billing error
        if (message.includes('credit balance') || message.includes('credit_balance')) {
          return 'Insufficient Anthropic API credits. Please add funds at console.anthropic.com';
        }
        return message.length > 150 ? message.slice(0, 147) + '...' : message;
      }
    } catch {
      // Fall through
    }
  }

  if (raw.includes('rate_limit') || (raw.includes('429') && raw.includes('anthropic'))) {
    return 'Anthropic API rate limit reached';
  }

  if (raw.includes('overloaded')) {
    return 'Anthropic API is temporarily overloaded';
  }

  return null;
}

function parseGenericError(raw: string): string {
  const lower = raw.toLowerCase();

  if (
    lower.includes('429') ||
    lower.includes('rate limit') ||
    lower.includes('rate_limit') ||
    lower.includes('quota exceeded') ||
    lower.includes('too many requests')
  ) {
    return 'Rate limit exceeded. Please try again later.';
  }

  if (lower.includes('api_key') || lower.includes('invalid key')) {
    return 'The API key for this provider is invalid or expired';
  }

  if (lower.includes('timeout')) {
    return 'The API request took too long to respond';
  }

  if (lower.includes('network') || lower.includes('connection')) {
    return 'Could not connect to the API';
  }

  if (raw.length > 100) {
    return raw.slice(0, 80) + '...';
  }

  return raw;
}
