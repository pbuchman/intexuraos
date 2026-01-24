# @intexuraos/llm-utils

Utility functions for LLM operations across IntexuraOS services.

## Overview

This package provides utilities for:

- Sensitive data redaction in logs
- LLM parse error handling and logging

## Installation

```bash
pnpm add @intexuraos/llm-utils
```

## Redaction Utilities

Safely redact sensitive data before logging.

### `redactToken`

Redact a single token/API key, showing only the last 4 characters.

```typescript
import { redactToken } from '@intexuraos/llm-utils';

redactToken('sk-1234567890abcdef');
// Returns: '***cdef'

redactToken(undefined);
// Returns: undefined
```

### `redactObject`

Recursively redact sensitive fields in objects.

```typescript
import { redactObject, SENSITIVE_FIELDS } from '@intexuraos/llm-utils';

const config = {
  apiKey: 'sk-secret123',
  model: 'gpt-4',
  headers: {
    Authorization: 'Bearer token123',
  },
};

const safe = redactObject(config);
// Returns: {
//   apiKey: '***123',
//   model: 'gpt-4',
//   headers: { Authorization: '***123' }
// }
```

### `SENSITIVE_FIELDS`

List of field names that are automatically redacted:

```typescript
const SENSITIVE_FIELDS = [
  'apiKey',
  'api_key',
  'apikey',
  'authorization',
  'Authorization',
  'token',
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh_token',
  'secret',
  'password',
  'credential',
  'credentials',
];
```

## Parse Error Utilities

Handle and log LLM response parsing errors consistently.

### `createLlmParseError`

Create a standardized parse error with details.

```typescript
import { createLlmParseError, type LlmParseErrorDetails } from '@intexuraos/llm-utils';

const details: LlmParseErrorDetails = {
  rawResponse: '{"invalid": json}',
  parseError: 'Unexpected token',
  model: 'gemini-2.5-flash',
  operation: 'extractContext',
};

const error = createLlmParseError(details);
// Returns: Error with structured message
```

### `logLlmParseError`

Log parse errors with consistent formatting.

```typescript
import { logLlmParseError } from '@intexuraos/llm-utils';

logLlmParseError(logger, {
  rawResponse: response,
  parseError: err.message,
  model: 'gemini-2.5-flash',
  operation: 'inferContext',
});
```

### `withLlmParseErrorLogging`

Wrap a parse function with automatic error logging.

```typescript
import { withLlmParseErrorLogging } from '@intexuraos/llm-utils';

const safeParse = withLlmParseErrorLogging(
  parseContextResponse,
  logger,
  'gemini-2.5-flash',
  'inferContext'
);

const result = safeParse(rawResponse);
// Automatically logs on parse failure
```

### `createDetailedParseErrorMessage`

Create detailed error messages for debugging.

```typescript
import { createDetailedParseErrorMessage } from '@intexuraos/llm-utils';

const message = createDetailedParseErrorMessage({
  rawResponse: response,
  parseError: 'Expected object, got array',
  model: 'gpt-4',
  operation: 'extractTodo',
});
// Returns multi-line error message with context
```

## Type Definitions

### `LlmParseErrorDetails`

```typescript
interface LlmParseErrorDetails {
  rawResponse: string;
  parseError: string;
  model: string;
  operation: string;
  additionalContext?: Record<string, unknown>;
}
```

## Dependencies

- `@intexuraos/common-core` - Logger type
