# @intexuraos/llm-utils — Agent Reference

Machine-readable export map and interface definitions for automated tooling.

## Package Metadata

```
name: @intexuraos/llm-utils
type: module
leaf: false
dependencies: @intexuraos/common-core, zod
entry_points:
  - ".": ./src/index.ts
```

## Exported Types

```typescript
interface LlmParseErrorDetails {
  errorMessage: string;
  llmResponse: string;
  expectedSchema: string;
  prompt?: string;
  operation: string;
}
```

## Exported Functions

```typescript
// redaction.ts
function redactToken(token: string | undefined | null): string;
function redactObject(
  obj: Record<string, unknown>,
  sensitiveFields: string[]
): Record<string, unknown>;

// parseError.ts
function createLlmParseError(options: {
  errorMessage: string;
  llmResponse: string;
  expectedSchema: string;
  operation: string;
  prompt?: string;
}): LlmParseErrorDetails;

function logLlmParseError(logger: Logger, details: LlmParseErrorDetails): void;

function withLlmParseErrorLogging<TInput, TOutput>(options: {
  logger: Logger;
  operation: string;
  expectedSchema: string;
  parser: (input: TInput) => TOutput;
  getPrompt?: () => string;
}): (input: TInput) => TOutput;

function createDetailedParseErrorMessage(options: {
  errorMessage: string;
  llmResponse: string;
  expectedSchema: string;
  operation: string;
}): string;

function formatZodErrors(error: ZodError): string;
```

## Exported Constants

```typescript
const SENSITIVE_FIELDS: readonly [
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
];
```

## Dependency Graph

```
common-core
  <- llm-utils
       <- llm-prompts
       <- common-http
       <- 6 apps (calendar-agent, commands-agent, linear-agent,
                   research-agent, todos-agent, web-agent)
```

## Usage Patterns

```typescript
// Redact sensitive data before logging
import { redactObject, SENSITIVE_FIELDS } from '@intexuraos/llm-utils';
logger.info({ config: redactObject(config, [...SENSITIVE_FIELDS]) }, 'LLM configured');

// Wrap a parser with error logging
import { withLlmParseErrorLogging } from '@intexuraos/llm-utils';
const safeParse = withLlmParseErrorLogging({
  logger,
  operation: 'parseChartDefinition',
  expectedSchema: '{ chartType: string, data: object[] }',
  parser: myParser,
});
const parsed = safeParse(llmResponse);

// Format Zod errors for user-facing messages
import { formatZodErrors } from '@intexuraos/llm-utils';
const result = schema.safeParse(data);
if (!result.success) {
  return err({ code: 'VALIDATION_ERROR', message: formatZodErrors(result.error) });
}
```
