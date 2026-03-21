# @intexuraos/llm-audit

LLM API audit logging to Firestore. Records every LLM request and response with full context — prompts, responses, token usage, costs, timing, and user attribution — for debugging, monitoring, and compliance.

**Version:** 3.3.0
**Node:** >=22.0.0
**Type:** ESM
**Dependencies:** `@intexuraos/common-core`, `@intexuraos/infra-firestore`, `@intexuraos/llm-contract`

## Why It Exists

When LLM calls fail or produce unexpected output, debugging requires the full request/response context: what prompt was sent, what the model returned, how long it took, and how many tokens were consumed. This package captures that context in Firestore as a complete audit trail. It also supports compliance requirements by logging every LLM interaction with user attribution.

## API Reference

### `isAuditEnabled(): boolean`

Checks the `INTEXURAOS_AUDIT_LLMS` env var. Defaults to `true`. Set to `false`, `0`, or `no` to disable.

```typescript
import { isAuditEnabled } from '@intexuraos/llm-audit';

if (isAuditEnabled()) {
  console.log('LLM calls will be audited');
}
```

### `createAuditContext(params: CreateAuditLogParams, options?: AuditContextOptions): AuditContext`

Creates an audit context that captures the start time at creation. Complete it later with `.success()` or `.error()`. Pass a custom sink via `options.sink` to override the default Firestore destination.

```typescript
import { createAuditContext } from '@intexuraos/llm-audit';

const audit = createAuditContext({
  provider: 'anthropic',
  model: 'claude-sonnet-4-5-20250929',
  method: 'research',
  prompt: 'Explain TypeScript generics',
  startedAt: new Date(),
  userId: 'user-123',
  researchId: 'research-456', // optional
});
```

### `AuditContext` class

Tracks an LLM request/response cycle. Can only be completed once — subsequent calls are silently ignored. This ensures timing accuracy even when callers hold a reference across async boundaries.

#### `.success(result: CompleteAuditLogSuccessParams): Promise<void>`

Records a successful LLM response.

```typescript
await audit.success({
  response: 'TypeScript generics allow...',
  inputTokens: 50,
  outputTokens: 200,
  costUsd: 0.003,
  webSearchCalls: 3,
});
```

Full success parameters:

| Parameter             | Type    | Required | Description                       |
| --------------------- | ------- | -------- | --------------------------------- |
| `response`            | string  | Yes      | LLM response content              |
| `inputTokens`         | number  | No       | Input token count                 |
| `outputTokens`        | number  | No       | Output token count                |
| `cacheCreationTokens` | number  | No       | Anthropic cache write tokens      |
| `cacheReadTokens`     | number  | No       | Anthropic cache read tokens       |
| `cachedTokens`        | number  | No       | OpenAI cached tokens              |
| `reasoningTokens`     | number  | No       | OpenAI reasoning tokens           |
| `webSearchCalls`      | number  | No       | Number of web search calls        |
| `groundingEnabled`    | boolean | No       | Whether Google grounding was used |
| `providerCost`        | number  | No       | Cost reported by provider         |
| `costUsd`             | number  | No       | Calculated cost in USD            |
| `imageCount`          | number  | No       | Number of images generated        |
| `imageModel`          | string  | No       | Image model used                  |
| `imageSize`           | string  | No       | Image dimensions                  |
| `imageCostUsd`        | number  | No       | Image generation cost             |

#### `.error(result: CompleteAuditLogErrorParams): Promise<void>`

Records a failed LLM request.

```typescript
try {
  const result = await llmClient.generate(prompt);
  await audit.success({ response: result.content, inputTokens: 100 });
} catch (error) {
  await audit.error({ error: getErrorMessage(error) });
}
```

### Audit Sinks

The sink determines where audit logs are persisted. Inject a custom sink via `createAuditContext(params, { sink })`.

| Sink                     | Destination                   | Use Case                            |
| ------------------------ | ----------------------------- | ----------------------------------- |
| `FirestoreAuditSink`     | Firestore `llm_api_logs`      | Default for all production services |
| `StructuredLogAuditSink` | Pino logger (structured JSON) | Services without Firestore access   |
| `NoopAuditSink`          | /dev/null                     | Tests, disabled auditing            |

All sinks implement `AuditSink`:

```typescript
interface AuditSink {
  save(log: LlmAuditLog): Promise<Result<void>>;
}
```

`StructuredLogAuditSink` requires a `Logger` dependency:

```typescript
import { StructuredLogAuditSink, createAuditContext } from '@intexuraos/llm-audit';

const sink = new StructuredLogAuditSink({ logger });
const audit = createAuditContext(params, { sink });
```

### Firestore Structure

All audit logs are stored in the `llm_api_logs` collection:

```
llm_api_logs/{uuid}
  id: string
  provider: 'google' | 'openai' | 'anthropic' | 'perplexity'
  model: string
  method: string
  prompt: string
  promptLength: number
  status: 'success' | 'error'
  response?: string
  responseLength?: number
  error?: string
  inputTokens?: number
  outputTokens?: number
  cacheCreationTokens?: number
  cacheReadTokens?: number
  cachedTokens?: number
  reasoningTokens?: number
  webSearchCalls?: number
  groundingEnabled?: boolean
  providerCost?: number
  costUsd?: number
  imageCount?: number
  imageModel?: string
  imageSize?: string
  imageCostUsd?: number
  startedAt: string (ISO)
  completedAt: string (ISO)
  durationMs: number
  userId?: string
  researchId?: string
  createdAt: string (ISO)
```

### Key Types

```typescript
type LlmAuditStatus = 'success' | 'error';

interface LlmAuditLog {
  id: string;
  provider: LlmProvider;
  model: string;
  method: string;
  prompt: string;
  promptLength: number;
  status: LlmAuditStatus;
  response?: string;
  responseLength?: number;
  error?: string;
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
  startedAt: string;
  completedAt: string;
  durationMs: number;
  userId?: string;
  researchId?: string;
  createdAt: string;
}

interface CreateAuditLogParams {
  provider: LlmProvider;
  model: string;
  method: string;
  prompt: string;
  startedAt: Date;
  userId?: string;
  researchId?: string;
}
```

## Configuration

| Env Var                 | Default | Description                                                     |
| ----------------------- | ------- | --------------------------------------------------------------- |
| `INTEXURAOS_AUDIT_LLMS` | `true`  | Set to `false`, `0`, or `no` to disable audit logging globally  |

## Used By

**Packages (4):** `infra-claude`, `infra-gemini`, `infra-gpt`, `infra-perplexity`

**Apps (1):** `image-service` (direct usage)

**Workers (1):** `orchestrator` (via `llm-factory`)

## Source Files

| File           | Purpose                                                                                |
| -------------- | -------------------------------------------------------------------------------------- |
| `src/index.ts` | Re-exports all types, `AuditContext`, and `isAuditEnabled`                             |
| `src/types.ts` | `LlmAuditLog`, `CreateAuditLogParams`, completion params                               |
| `src/audit.ts` | `AuditContext` class, `createAuditContext`, `isAuditEnabled`                           |
| `src/sink.ts`  | `AuditSink` interface, `FirestoreAuditSink`, `StructuredLogAuditSink`, `NoopAuditSink` |
