# GitHub PR Events Aggregation

**Issue:** INT-525
**Status:** Implementation
**Owner:** code-agent
**Created:** 2026-02-05

---

## Overview

Aggregates GitHub webhook events for pull requests to provide historical context within the Code Agent UI. Users can see the full timeline of PR events (opened, reviews, comments, merges) alongside their code tasks.

### Goals

1. **Receive** GitHub webhook events for pull requests
2. **Store** events in Firestore for historical querying
3. **Display** PR event timeline in the web UI
4. **Verify** webhook signatures for security

### Non-Goals

- Real-time WebSocket updates (polling is sufficient)
- Full GitHub API integration (webhooks only)
- Automated PR creation/commenting

---

## Architecture

```
GitHub ──webhook──> code-agent: POST /webhooks/github
                          |
                          v
                    Signature Verification
                          |
                          v
                    Event Parser
                          |
                          v
              github-pr-events (Firestore)
                          ^
                          |
                    GET /code/github-pr-events
                          ^
                          |
                       web-app (React UI)
```

---

## Firestore Schema

### Collection: `github-pr-events`

**Owner:** `code-agent`

| Field               | Type           | Description                                          | Indexed                                             |
| ------------------- | -------------- | ---------------------------------------------------- | --------------------------------------------------- |
| `id`                | string         | UUID (primary key)                                   | -                                                   |
| `githubEventId`     | number         | GitHub event ID for deduplication                    | Yes                                                 |
| `repository`        | string         | "owner/repo" format                                  | Yes                                                 |
| `repositoryId`      | number         | GitHub repository numeric ID                         | -                                                   |
| `pullRequestNumber` | number         | PR number                                            | Yes                                                 |
| `pullRequestId`     | number         | GitHub PR node ID                                    | -                                                   |
| `eventType`         | string         | Event type (pull_request, pull_request_review, etc.) | -                                                   |
| `action`            | string \       | null                                                 | Action (opened, closed, submitted, dismissed, etc.) | - |
| `senderLogin`       | string         | GitHub username of sender                            | -                                                   |
| `senderId`          | number         | GitHub numeric ID of sender                          | -                                                   |
| `senderType`        | string         | User type (User, Bot)                                | -                                                   |
| `title`             | string \       | null                                                 | PR title                                            | - |
| `body`              | string \       | null                                                 | PR description/review body                          | - |
| `state`             | string \       | null                                                 | PR state (open, closed)                             | - |
| `mergedAt`          | Date \         | null                                                 | When PR was merged                                  | - |
| `createdAt`         | Date           | Event timestamp from GitHub                          | Yes                                                 |
| `processedAt`       | Date           | Server timestamp                                     | -                                                   |
| `payload`           | unknown        | Full webhook payload for debugging                   | -                                                   |

### Composite Indexes

1. **PR timeline query**
   - `repository` (ASC) + `pullRequestNumber` (ASC) + `createdAt` (DESC)
   - Query: Get all events for a specific PR, ordered newest first

2. **Repository activity query**
   - `repository` (ASC) + `createdAt` (DESC)
   - Query: Get recent events across all PRs in a repository

### Deduplication

- **Unique constraint:** `githubEventId` (GitHub's event ID)
- **Rationale:** GitHub may retry webhook delivery; we should store each event only once
- **Implementation:** Check for existing `githubEventId` before insert

### Repository Scope

- **Process only:** `intexuraos/*` repositories
- **Ignore others:** Accept webhook but don't store (return 200 OK)
- **Rationale:** Prevents storing events for forks or unrelated repos

---

## API Endpoints

### POST /webhooks/github

**Purpose:** Receive GitHub webhook events

**Auth:** GitHub HMAC signature (X-Hub-Signature-256 header)

**Request:**

- Headers: `X-Hub-Signature-256: sha256=<hex-digest>`, `X-GitHub-Event: <event-type>`
- Body: Raw JSON payload

**Response:**

- `200 OK` - Event processed or ignored (non-IntexuraOS repo)
- `401 Unauthorized` - Invalid signature
- `400 Bad Request` - Invalid payload

**Event Types Handled:**
| Event Type                    | Action Stored                                                              |
| ----------------------------- | -------------------------------------------------------------------------- |
| `pull_request`                | opened, closed, edited, synchronized, ready_for_review, converted_to_draft |
| `pull_request_review`         | submitted, edited, dismissed                                               |
| `pull_request_review_comment` | created, edited, deleted                                                   |
| `push`                        | Yes (for context, associated with PR via branch)                           |
| `ping`                        | No (acknowledge only)                                                      |

---

### GET /code/github-pr-events

**Purpose:** Query PR events for web UI

**Auth:** Bearer token (JWT)

**Query Parameters:**
| Parameter           | Type   | Required   | Description                        |
| ------------------- | ------ | ---------- | ---------------------------------- |
| `repository`        | string | Yes        | Repository in "owner/repo" format  |
| `pullRequestNumber` | number | No         | Filter to specific PR              |
| `limit`             | number | No         | Max events (default: 50, max: 100) |

**Response:**

```json
{
  "success": true,
  "data": {
    "events": [
      {
        "id": "uuid",
        "eventType": "pull_request",
        "action": "opened",
        "pullRequestNumber": 123,
        "title": "Add feature X",
        "senderLogin": "username",
        "createdAt": "2026-02-05T10:00:00Z"
      }
    ]
  }
}
```

---

## Webhook Signature Verification

GitHub signs webhook payloads using HMAC-SHA256 with the shared secret.

### Process

1. Extract signature from `X-Hub-Signature-256` header (format: `sha256=<hex>`)
2. Compute HMAC-SHA256 of raw request body using `GITHUB_WEBHOOK_SECRET`
3. Use timing-safe comparison (`crypto.timingSafeEqual`) to prevent timing attacks
4. Reject with `401 Unauthorized` if signatures don't match

### Implementation

```typescript
import { createHash, timingSafeEqual } from 'node:crypto';

function verifySignature(payload: Buffer, signature: string, secret: string): boolean {
  const expectedPrefix = 'sha256=';
  if (!signature.startsWith(expectedPrefix)) {
    return false;
  }

  const receivedDigest = Buffer.from(signature.slice(expectedPrefix.length), 'hex');
  const hmac = createHash('sha256');
  hmac.update(secret);
  hmac.update(payload);
  const expectedDigest = Buffer.from(hmac.digest('hex'), 'hex');

  return (
    receivedDigest.length === expectedDigest.length &&
    timingSafeEqual(receivedDigest, expectedDigest)
  );
}
```

---

## Security Considerations

1. **Signature verification:** Mandatory for all webhook requests
2. **Repository scope:** Only process IntexuraOS repositories
3. **Rate limiting:** Webhook delivery is controlled by GitHub
4. **Payload sanitization:** Store full payload for debugging, never expose in API responses

---

## Testing Strategy

### Unit Tests

- Signature verification (valid, invalid, malformed)
- Event parsing for each supported event type
- Repository filtering (IntexuraOS vs others)
- Deduplication logic

### Integration Tests

- Full webhook flow with mock signatures
- Firestore queries with indexes
- API endpoint authentication and responses

### E2E Tests

- Manual: Create test PR in IntexuraOS repo
- Verify: Event appears in UI

---

## Rollout Plan

1. **Phase 1:** Backend infrastructure (INT-528, INT-529)
2. **Phase 2:** UI integration (INT-530, INT-531)
3. **Phase 3:** Verification (INT-532)

---

## Future Enhancements (Out of Scope)

- Real-time updates via Firestore listeners
- Comment threading display
- Diff visualization
- PR linking to code tasks
- Webhook delivery status monitoring
