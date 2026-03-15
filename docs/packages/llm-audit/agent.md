# @intexuraos/llm-audit — Agent Reference

> Machine-readable interface for automated tooling and AI agents.

## Identity

| Attribute | Value                                                         |
| --------- | ------------------------------------------------------------- |
| Package   | `@intexuraos/llm-audit`                                       |
| Role      | Audit sink for LLM request/response pairs                     |
| Goal      | Persist a complete, timestamped record of every LLM call      |
| Firestore | `llm_api_logs` (owner: this package via `FirestoreAuditSink`) |

## Exports

### Functions

| Export               | Signature                                                                       | Purpose                         |
| -------------------- | ------------------------------------------------------------------------------- | ------------------------------- |
| `isAuditEnabled`     | `() => boolean`                                                                 | Check `INTEXURAOS_AUDIT_LLMS`   |
| `createAuditContext` | `(params: CreateAuditLogParams, options?: AuditContextOptions) => AuditContext` | Create an audit context         |

### Classes

| Export                   | Purpose                                    |
| ------------------------ | ------------------------------------------ |
| `AuditContext`           | Tracks one LLM request/response cycle      |
| `FirestoreAuditSink`     | Default sink — writes to `llm_api_logs`    |
| `StructuredLogAuditSink` | Sink that emits to a Pino logger           |
| `NoopAuditSink`          | Sink that discards all events (tests only) |

### Key Types

```typescript
interface AuditSink {
  save(log: LlmAuditLog): Promise<Result<void>>;
}

interface AuditContextOptions {
  sink?: AuditSink;
}

interface CreateAuditLogParams {
  provider: LlmProvider; // 'google' | 'openai' | 'anthropic' | 'perplexity'
  model: string;
  method: string;
  prompt: string;
  startedAt: Date;
  userId?: string;
  researchId?: string;
}

interface CompleteAuditLogSuccessParams {
  response: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  cachedTokens?: number;
  reasoningTokens?: number;
  webSearchCalls?: number;
  groundingEnabled?: boolean;
  providerCost?: number;
  costUsd?: number;
  imageCount?: number;
  imageModel?: string;
  imageSize?: string;
  imageCostUsd?: number;
}

interface CompleteAuditLogErrorParams {
  error: string;
}
```

## Usage Pattern

```typescript
// 1. Create context at request start (captures timestamp)
const audit = createAuditContext({ provider, model, method, prompt, startedAt, userId });

// 2a. Complete on success
await audit.success({ response, inputTokens, outputTokens, costUsd });

// 2b. Complete on error
await audit.error({ error: 'Rate limit exceeded' });

// Subsequent calls to success/error are silently ignored.
```

## Constraints

**Do NOT:**
- Call `audit.success()` or `audit.error()` more than once (silently ignored after first call)
- Await the result of sink writes when auditing is non-critical — sink errors are swallowed
- Use `FirestoreAuditSink` in tests — use `NoopAuditSink` instead

**Requires:**
- `INTEXURAOS_AUDIT_LLMS` defaults to `true`; no config needed to enable
- Firestore must be initialized before `FirestoreAuditSink.save()` is called

## Environment Variables

| Variable                | Default | Values                     |
| ----------------------- | ------- | -------------------------- |
| `INTEXURAOS_AUDIT_LLMS` | `true`  | `true`, `false`, `0`, `no` |

## Dependencies

| Package                       | Why Needed                            |
| ----------------------------- | ------------------------------------- |
| `@intexuraos/common-core`     | `Result` type, `getErrorMessage`      |
| `@intexuraos/infra-firestore` | Firestore client for default sink     |
| `@intexuraos/llm-contract`    | `LlmProvider` type re-export          |
