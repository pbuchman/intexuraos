# Agent Template

Template for `docs/services/<service-name>/agent.md`.

## Purpose

Machine-readable interface definition for other AI agents to understand and interact with the service.

**Note:** This file is only generated in autonomous mode (service-scribe agent).

---

## Template

```markdown
# <Service Name> — Agent Interface

> **Machine-readable specification for AI agent integration**

## Identity

| Attribute | Value                                      |
| --------- | ------------------------------------------ |
| Name      | <service-name>                             |
| Role      | <One sentence describing what it does>     |
| Goal      | <Primary outcome the service achieves>     |

## Capabilities

### <Capability 1>

**Endpoint:** `POST /path`

**When to use:** <Conditions that make this the right choice>

**Input Schema:**
```typescript
interface Input {
  field1: string;
  field2: number;
  optional?: boolean;
}
```

**Output Schema:**
```typescript
interface Output {
  id: string;
  status: 'pending' | 'completed';
  result?: ResultData;
}
```

**Example:**
```json
// Request
{
  "field1": "value",
  "field2": 42
}

// Response
{
  "id": "abc-123",
  "status": "completed",
  "result": { "data": "..." }
}
```

### <Capability 2>

...

## Constraints

**Do NOT:**
- <Constraint 1 — what the service cannot do>
- <Constraint 2>
- <Constraint 3>

**Requires:**
- <Prerequisite 1 — what must happen before calling>
- <Prerequisite 2>

## Usage Patterns

### Pattern 1: <Common Workflow>

```
1. Call GET /resource to check state
2. If condition met, call POST /resource/action
3. Poll GET /resource/:id until status === 'completed'
```

### Pattern 2: <Another Workflow>

```
1. ...
```

## Error Handling

| Error Code | Meaning                | Recovery Action        |
| ---------- | ---------------------- | ---------------------- |
| 400        | Invalid input          | Fix request payload    |
| 401        | Unauthorized           | Refresh token          |
| 404        | Resource not found     | Verify ID exists       |
| 429        | Rate limited           | Wait and retry         |
| 500        | Server error           | Retry with backoff     |

## Rate Limits

| Endpoint      | Limit           | Window  |
| ------------- | --------------- | ------- |
| POST /create  | 100 requests    | 1 hour  |
| GET /list     | 1000 requests   | 1 hour  |

## Events Published

| Event            | When                    | Payload Schema        |
| ---------------- | ----------------------- | --------------------- |
| `resource.created` | After successful create | `{ id, userId, ... }` |
| `resource.updated` | After successful update | `{ id, changes, ... }` |

## Dependencies

| Service      | Why Needed                    | Failure Behavior      |
| ------------ | ----------------------------- | --------------------- |
| user-service | Validate user ownership       | Reject request        |
| pubsub       | Publish events                | Queue for retry       |
```

---

## Quality Requirements

### Conciseness

- Remove all fluff and marketing language
- Focus on actionable information
- Use code examples over prose explanations

### Schema Validity

- All TypeScript interfaces must be valid
- Use union types for enums
- Mark optional fields with `?`

### Examples

- Every capability needs a concrete example
- Show both request and response
- Use realistic but simple data

---

## Example

```markdown
# WhatsApp Service — Agent Interface

> **Machine-readable specification for AI agent integration**

## Identity

| Attribute | Value                                           |
| --------- | ----------------------------------------------- |
| Name      | whatsapp-service                                |
| Role      | Send and receive WhatsApp messages              |
| Goal      | Enable mobile-first task capture via messaging  |

## Capabilities

### Send Message

**Endpoint:** `POST /internal/messages/send`

**When to use:** When you need to send a WhatsApp message to a user

**Input Schema:**
```typescript
interface SendMessageInput {
  userId: string;
  message: string;
  templateId?: string;
}
```

**Output Schema:**
```typescript
interface SendMessageOutput {
  messageId: string;
  status: 'queued' | 'sent' | 'failed';
  timestamp: string;
}
```

**Example:**
```json
// Request
{
  "userId": "user-abc-123",
  "message": "Your todo has been created!"
}

// Response
{
  "messageId": "msg-xyz-789",
  "status": "sent",
  "timestamp": "2025-01-15T10:30:00Z"
}
```

## Constraints

**Do NOT:**
- Send messages without user consent
- Send more than 10 messages per minute per user
- Use for marketing without explicit opt-in

**Requires:**
- User must have verified phone number
- User must have active session

## Usage Patterns

### Pattern 1: Notification After Action

```
1. Receive action completion event
2. Lookup user notification preferences
3. If WhatsApp enabled, call POST /internal/messages/send
4. Log delivery status
```
```
