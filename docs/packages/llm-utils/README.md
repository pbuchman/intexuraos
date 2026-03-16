# @intexuraos/llm-utils

Shared utility functions for LLM operations across IntexuraOS. Provides two core capabilities: sensitive data redaction for safe logging and structured error handling for LLM response parsing failures.

**Node:** >=22.0.0
**Type:** ESM
**Dependencies:** `@intexuraos/common-core`, `zod`

## Why It Exists

LLM operations produce two recurring problems: (1) API keys and tokens leak into logs, and (2) LLM responses frequently fail to match expected schemas, requiring structured error context for debugging. This package centralizes both concerns so every LLM-related package and app handles them consistently.

## API Reference

### Redaction Utilities (`redaction.ts`)

#### `redactToken(token: string | undefined | null): string`

Masks a token for safe logging. Shows first 4 and last 4 characters for tokens longer than 12 characters.

```typescript
import { redactToken } from '@intexuraos/llm-utils';

redactToken('sk-abcdefghijklmnop'); // 'sk-a...mnop'
redactToken('short'); // '[REDACTED]'
redactToken(undefined); // '[empty]'
redactToken(''); // '[empty]'
```

#### `redactObject(obj: Record<string, unknown>, sensitiveFields: string[]): Record<string, unknown>`

Creates a shallow copy of an object with specified string fields redacted.

```typescript
import { redactObject, SENSITIVE_FIELDS } from '@intexuraos/llm-utils';

const config = { apiKey: 'sk-secret-key-value', model: 'gemini-2.5-flash' };
const safe = redactObject(config, SENSITIVE_FIELDS);
// { apiKey: 'sk-s...alue', model: 'gemini-2.5-flash' }
```

#### `SENSITIVE_FIELDS`

Default list of field names that should be redacted:

```typescript
const SENSITIVE_FIELDS = [
  'password',
  'token',
  'access_token',
  'refresh_token',
  'id_token',
  'device_code',
  'authorization',
  'secret',
  'api_key',
  'apiKey',
  'client_secret',
  'clientSecret',
  'x-internal-auth',
  'x-goog-iap-jwt-assertion',
] as const;
```

### Parse Error Utilities (`parseError.ts`)

#### `createLlmParseError(options): LlmParseErrorDetails`

Creates a structured error object with full debugging context when an LLM response fails to parse.

```typescript
import { createLlmParseError } from '@intexuraos/llm-utils';

const details = createLlmParseError({
  errorMessage: 'Expected JSON, got plain text',
  llmResponse: rawResponse, // auto-truncated to 1000 chars
  expectedSchema: '{ title: string, quality: 0 | 1 | 2 }',
  operation: 'parseTitleResponse',
  prompt: originalPrompt, // optional, truncated to 500 chars
});
```

#### `logLlmParseError(logger: Logger, details: LlmParseErrorDetails): void`

Logs a parse error in structured format queryable in logging systems and Sentry.

```typescript
import { logLlmParseError, createLlmParseError } from '@intexuraos/llm-utils';

const details = createLlmParseError({ /* ... */ });
logLlmParseError(logger, details);
// Logs at warn level with operation, errorMessage, llmResponse, expectedSchema
```

#### `withLlmParseErrorLogging<TInput, TOutput>(options): (input: TInput) => TOutput`

Wraps a parser function with automatic error logging. On parse failure, logs full context before re-throwing.

```typescript
import { withLlmParseErrorLogging } from '@intexuraos/llm-utils';

const safeParse = withLlmParseErrorLogging({
  logger,
  operation: 'parseChartDefinition',
  expectedSchema: 'CHART_CONFIG_START {...} CHART_CONFIG_END',
  parser: parseChartDefinition,
});

const result = safeParse(llmResponse); // Logs and re-throws on failure
```

#### `createDetailedParseErrorMessage(options): string`

Creates a multi-line error message for `Result`-based error flows (where you return errors rather than throw).

```typescript
import { createDetailedParseErrorMessage } from '@intexuraos/llm-utils';

const message = createDetailedParseErrorMessage({
  errorMessage: 'Invalid JSON',
  llmResponse: rawResponse,
  expectedSchema: '{ title: string }',
  operation: 'parseTitleResponse',
});
// Returns formatted string with expected schema and truncated response
```

#### `formatZodErrors(error: ZodError): string`

Formats Zod validation errors into human-readable messages. Limits output to 5 issues to prevent log bloat.

```typescript
import { formatZodErrors } from '@intexuraos/llm-utils';

const result = schema.safeParse(data);
if (!result.success) {
  const msg = formatZodErrors(result.error);
  // "quality: expected 0 | 1 | 2, received '5'; title: expected string, received 'undefined'"
}
```

### Types

```typescript
interface LlmParseErrorDetails {
  errorMessage: string;
  llmResponse: string;
  expectedSchema: string;
  prompt?: string;
  operation: string;
}
```

## Used By

**Packages (2):** `llm-prompts`, `common-http`

**Apps (6):** `calendar-agent`, `commands-agent`, `linear-agent`, `research-agent`, `todos-agent`, `web-agent`

> **Note:** `common-http` re-exports `redactToken`, `redactObject`, and `SENSITIVE_FIELDS` from this package, making redaction utilities available to all HTTP services via `@intexuraos/common-http`.

## Recent Changes

| Commit      | Description                                       |
| ----------- | ------------------------------------------------- |
| `44017d5c9` | Fix ESLint OOM with batched parallel lint runner  |
| `35f4c6990` | Migrate LLM validation to Zod schemas (3/8)       |

## Source Files

| File                | Purpose                                               |
| ------------------- | ----------------------------------------------------- |
| `src/index.ts`      | Re-exports all utilities                              |
| `src/redaction.ts`  | Token/object redaction and sensitive field list       |
| `src/parseError.ts` | LLM parse error creation, logging, and Zod formatting |
