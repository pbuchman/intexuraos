# @intexuraos/llm-audit

LLM audit logging to Firestore for debugging and monitoring.

## Purpose

Logs all LLM requests and responses with:

- Request metadata (model, provider, timestamp)
- Full prompt text
- Response content (truncated if too long)
- Token usage details
- Error information

This provides a complete audit trail for debugging and compliance.

## Usage

The `AuditContext` is created automatically by all LLM clients:

```ts
import { createAuditContext } from '@intexuraos/llm-audit';

const auditContext = createAuditContext({
  provider: 'anthropic',
  model: 'claude-sonnet-4-5',
  method: 'generate',
  prompt: 'Explain TypeScript',
  startedAt: new Date(),
});

// Log successful completion
await auditContext.success({
  response: 'TypeScript is a typed superset of JavaScript...',
  inputTokens: 5,
  outputTokens: 20,
});

// Or log error
await auditContext.error({ error: 'Rate limit exceeded' });
```

## Firestore Structure

Audit logs are stored in `llm_audit_logs/{year}/{month}/{day}/{requestId}`:

```
llm_audit_logs/
  2026/
    01/
      13/
        {requestId}/  # One document per request
```

Each audit log contains:

- `requestId`: Unique identifier
- `provider`: LLM provider (anthropic, openai, google, perplexity)
- `model`: Model used
- `method`: Operation type (research, generate, generateImage)
- `prompt`: Full request prompt
- `startedAt`: Request start timestamp
- `completedAt`: Request completion timestamp
- `status`: 'success' or 'error'
- `response`: Response content (success only)
- `errorMessage`: Error details (error only)
- `inputTokens`: Input token count
- `outputTokens`: Output token count
- `webSearchCalls`: Number of web search calls
- `durationMs`: Request duration in milliseconds

## Configuration

| Environment Variable    | Description          | Default |
| ----------------------- | -------------------- | ------- |
| `INTEXURAOS_AUDIT_LLMS` | Enable audit logging | `true`  |

## Security

- Prompt and response contents are logged as-is
- API keys are never logged (use `***` placeholders)
- Audit logs should have appropriate Firestore security rules
- Consider data retention policies for compliance
