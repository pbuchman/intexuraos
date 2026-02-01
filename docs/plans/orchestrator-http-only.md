# Plan: Orchestrator HTTP-Only Communication

## Overview

**Goal:** Remove direct Firestore access from the orchestrator worker. All communication between orchestrator and code-agent must happen via HTTP.

**Why:** The orchestrator runs on remote machines (VMs, local dev) that may not have GCP Firestore access. It should communicate with code-agent (which owns Firestore) via HTTP only.

**Scope:** `workers/orchestrator/` only. Other workers (predev-lifecycle, vm-lifecycle, log-cleanup) are out of scope.

---

## Current State

### What orchestrator does today:

1. **Receives tasks** from code-agent via HTTP (`POST /tasks`) ✅
2. **Sends task completion** to code-agent via HTTP (`POST /internal/webhooks/task-complete`) ✅
3. **Forwards logs** directly to Firestore (`code_tasks/{taskId}/logs`) ❌ NEEDS CHANGE
4. **Heartbeat** feature exists but is NOT wired into production ❌ NEEDS WIRING

### Current Firestore usage in orchestrator:

| File                   | Usage                                | Action         |
| ---------------------- | ------------------------------------ | -------------- |
| `start.ts:166`         | `getFirestore()` initialization      | REMOVE         |
| `start.ts:194-200`     | Firestore passed to LogForwarder     | CHANGE to HTTP |
| `log-forwarder.ts:233` | Writes to `code_tasks/{taskId}/logs` | CHANGE to HTTP |

### Current environment variables:

| Variable                             | Used For                        | Action                                     |
| ------------------------------------ | ------------------------------- | ------------------------------------------ |
| `INTEXURAOS_DISPATCH_SIGNING_SECRET` | Verify requests FROM code-agent | RENAME to `INTEXURAOS_ORCHESTRATOR_SECRET` |
| `INTEXURAOS_INTERNAL_AUTH_SECRET`    | In `heartbeat.ts` but NOT wired | REMOVE (wrong trust model)                 |
| `GOOGLE_APPLICATION_CREDENTIALS`     | Firebase init + Secret Manager  | KEEP (for Secret Manager only)             |

---

## Target State

### Communication pattern:

```
code-agent ──[HTTP]──► orchestrator (dispatch tasks, cancel, health)
orchestrator ──[HTTP]──► code-agent (logs, heartbeat, task-complete)
```

### Authentication:

- **All HTTP calls** use HMAC signing with `INTEXURAOS_ORCHESTRATOR_SECRET`
- **No internal auth** — orchestrator is an external client, not an internal service
- **Per-worker secret** — each orchestrator has its own secret configured in UI + env var

---

## Checkpoint 1: Rename Secret (Non-Breaking)

**Goal:** Rename `DISPATCH_SIGNING_SECRET` to `ORCHESTRATOR_SECRET` everywhere.

### 1.1 Update orchestrator code

**File:** `workers/orchestrator/src/start.ts`

Find:

```typescript
const dispatchSecret = getRequiredEnv('INTEXURAOS_DISPATCH_SIGNING_SECRET');
```

Replace with:

```typescript
const orchestratorSecret = getRequiredEnv('INTEXURAOS_ORCHESTRATOR_SECRET');
```

Also update all references to `dispatchSecret` variable to `orchestratorSecret`.

**File:** `workers/orchestrator/src/routes.ts`

Update config interface and usage from `dispatchSecret` to `orchestratorSecret`.

**File:** `workers/orchestrator/src/types/config.ts`

If there's a config type, update the field name.

### 1.2 Update orchestrator tests

Search for `DISPATCH_SIGNING_SECRET` or `dispatchSecret` in:

- `workers/orchestrator/src/__tests__/*.ts`

Replace all occurrences with the new name.

### 1.3 Update code-agent code

**File:** `apps/code-agent/src/infra/services/hmacSigning.ts`

Find comment referencing `INTEXURAOS_DISPATCH_SECRET` and update.

**File:** `apps/code-agent/src/domain/models/workerSettings.ts`

Find:

```typescript
/** HMAC signing secret - must match DISPATCH_SECRET on the orchestrator */
```

Update comment to reference new name.

### 1.4 Update UI

**File:** `apps/web/src/pages/WorkerSettingsPage.tsx`

Find all labels "Dispatch Signing Secret" (around lines 241, 534) and rename to:

```
"Orchestrator Secret"
```

Update placeholder text from:

```
"HMAC signing secret for task dispatch"
```

To:

```
"Shared secret for code-agent ↔ orchestrator communication"
```

### 1.5 Update Terraform

**File:** `terraform/environments/dev/main.tf`

Search for `DISPATCH_SIGNING_SECRET` and rename to `ORCHESTRATOR_SECRET`.

### 1.6 Update ecosystem.config.cjs

**File:** `ecosystem.config.cjs`

Search for `DISPATCH_SIGNING_SECRET` and rename.

### 1.7 Verification

```bash
# Search for any remaining references
grep -r "DISPATCH_SIGNING_SECRET" --include="*.ts" --include="*.tsx" --include="*.tf" --include="*.cjs" .
grep -r "dispatchSecret" --include="*.ts" --include="*.tsx" .

# Both should return 0 results (except possibly comments explaining migration)

# Run CI
pnpm run ci:tracked
```

---

## Checkpoint 2: Remove INTERNAL_AUTH_SECRET from Orchestrator

**Goal:** Remove the unused `INTEXURAOS_INTERNAL_AUTH_SECRET` references.

### 2.1 Update heartbeat.ts

**File:** `workers/orchestrator/src/heartbeat.ts`

Find (around line 36):

```typescript
const internalAuthSecret = process.env['INTEXURAOS_INTERNAL_AUTH_SECRET'] ?? '';
```

This will be replaced in Checkpoint 4 when we wire heartbeat properly.

For now, if heartbeat is not wired into production, we can skip this and handle it in Checkpoint 4.

### 2.2 Update heartbeat tests

**File:** `workers/orchestrator/src/__tests__/heartbeat.test.ts`

Remove all references to `INTEXURAOS_INTERNAL_AUTH_SECRET`.

### 2.3 Update Terraform (if present)

**File:** `terraform/environments/dev/main.tf`

Search for `INTERNAL_AUTH_SECRET` in orchestrator section and remove.

### 2.4 Verification

```bash
grep -r "INTERNAL_AUTH_SECRET" workers/orchestrator/
# Should return 0 results

pnpm run ci:tracked
```

---

## Checkpoint 3: Add CODE_AGENT_URL to Orchestrator

**Goal:** Orchestrator needs to know the code-agent URL for HTTP calls.

### 3.1 Add environment variable loading

**File:** `workers/orchestrator/src/start.ts`

Add new required env var:

```typescript
const codeAgentUrl = getRequiredEnv('INTEXURAOS_CODE_AGENT_URL');
```

### 3.2 Add to config type

**File:** `workers/orchestrator/src/types/config.ts`

Add to `OrchestratorConfig`:

```typescript
codeAgentUrl: string;
```

### 3.3 Pass to services

In `start.ts`, pass `codeAgentUrl` to:

- LogForwarder (new parameter)
- HeartbeatManager (already expects it in config)

### 3.4 Update Terraform

**File:** `terraform/environments/dev/main.tf`

Add to orchestrator environment variables:

```hcl
INTEXURAOS_CODE_AGENT_URL = "https://code-agent.intexuraos.cloud"
```

### 3.5 Update ecosystem.config.cjs

Add `INTEXURAOS_CODE_AGENT_URL` to local dev configuration.

### 3.6 Verification

```bash
pnpm run ci:tracked
```

---

## Checkpoint 4: Convert LogForwarder to HTTP

**Goal:** Replace direct Firestore writes with HTTP calls to code-agent.

### 4.1 Update LogForwarder interface

**File:** `workers/orchestrator/src/services/log-forwarder.ts`

Change config from:

```typescript
export interface LogForwarderConfig {
  logBasePath: string;
  firestore: {
    collection: (path: string) => {
      add: (data: LogChunkData) => Promise<{ id: string }>;
    };
  };
}
```

To:

```typescript
export interface LogForwarderConfig {
  logBasePath: string;
  codeAgentUrl: string;
  orchestratorSecret: string;
}
```

### 4.2 Implement HTTP sending

Replace the Firestore write in `sendBatch` method with HTTP call:

```typescript
private async sendBatch(taskId: string, chunks: string[], state: ForwardingState): Promise<void> {
  const chunkPayloads = chunks.map((chunk, index) => {
    const truncated = this.enforceChunkSize(chunk);
    return {
      sequence: state.sequence + index,
      content: truncated,
      timestamp: new Date().toISOString(),
    };
  });

  const payload = {
    taskId,
    chunks: chunkPayloads,
  };

  const success = await this.sendWithRetry(payload);

  if (success) {
    state.sequence += chunks.length;
    state.chunksSent += chunks.length;
    state.totalBytes += chunks.reduce((sum, c) => sum + c.length, 0);
  } else {
    state.droppedChunks += chunks.length;
    this.logger.error({ taskId }, 'Failed to upload log chunks after retries');
  }
}

private async sendWithRetry(payload: unknown): Promise<boolean> {
  const url = `${this.config.codeAgentUrl}/internal/logs`;
  const jsonBody = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = this.signPayload(jsonBody, timestamp);

  const delays = [1000, 2000, 4000];

  for (let i = 0; i < 3; i++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Timestamp': String(timestamp),
          'X-Request-Signature': signature,
        },
        body: jsonBody,
      });

      if (response.ok) return true;
      if (response.status >= 400 && response.status < 500) return false; // Don't retry 4xx

    } catch (error) {
      this.logger.warn({ attempt: i + 1, error }, 'Log upload failed, retrying');
    }

    if (i < 2) {
      await new Promise(resolve => setTimeout(resolve, delays[i]));
    }
  }

  return false;
}

private signPayload(payload: string, timestamp: number): string {
  const message = `${String(timestamp)}.${payload}`;
  return createHmac('sha256', this.config.orchestratorSecret)
    .update(message)
    .digest('hex');
}
```

### 4.3 Update start.ts

Remove Firestore initialization:

```typescript
// REMOVE these lines:
const firestore = getFirestore();

// REMOVE the firestore wrapper passed to LogForwarder
```

Update LogForwarder instantiation:

```typescript
const logForwarder = new LogForwarder(
  {
    logBasePath: config.logBasePath,
    codeAgentUrl: config.codeAgentUrl,
    orchestratorSecret: config.orchestratorSecret,
  },
  logger
);
```

### 4.4 Remove Firebase imports

**File:** `workers/orchestrator/src/start.ts`

Remove:

```typescript
import { initializeApp, cert, type ServiceAccount } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
```

Remove the Firebase initialization block (keep only Secret Manager via gcloud CLI).

### 4.5 Update code-agent /internal/logs endpoint

**File:** `apps/code-agent/src/routes/webhookRoutes.ts`

The endpoint exists (lines 410-573). Verify it:

1. Accepts HMAC authentication (not X-Internal-Auth)
2. Uses `X-Request-Timestamp` and `X-Request-Signature` headers
3. Validates signature against the worker's `orchestratorSecret` (renamed from dispatchSigningSecret)

If it currently uses `X-Internal-Auth`, update to use HMAC validation matching the task-complete webhook pattern.

### 4.6 Update tests

**File:** `workers/orchestrator/src/__tests__/log-forwarder.test.ts`

Replace Firestore mocks with HTTP mocks (use `nock` or `vi.mock('node:fetch')`).

Test scenarios:

- Successful HTTP send
- HTTP retry on 5xx
- No retry on 4xx
- Dropped chunks after max retries

### 4.7 Verification

```bash
pnpm run ci:tracked
```

---

## Checkpoint 5: Wire Heartbeat into Production

**Goal:** Enable heartbeat feature with proper authentication.

### 5.1 Update heartbeat.ts authentication

**File:** `workers/orchestrator/src/heartbeat.ts`

Remove the `X-Internal-Auth` header usage. Replace with HMAC signing:

```typescript
async function sendHeartbeats(): Promise<void> {
  if (runningTasks.size === 0) {
    logger.debug('No running tasks, skipping heartbeat');
    return;
  }

  const taskIds = Array.from(runningTasks);
  logger.info({ taskCount: taskIds.length }, 'Sending heartbeats');

  const payload = { taskIds };
  const jsonBody = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = signPayload(jsonBody, config.orchestratorSecret, timestamp);

  try {
    const response = await fetch(`${config.codeAgentUrl}/internal/code/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Request-Timestamp': String(timestamp),
        'X-Request-Signature': signature,
      },
      body: jsonBody,
    });

    if (!response.ok) {
      logger.warn({ status: response.status }, 'Heartbeat request failed');
    } else {
      logger.debug({ taskCount: taskIds.length }, 'Heartbeats sent successfully');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ error: message }, 'Failed to send heartbeats');
  }
}

function signPayload(payload: string, secret: string, timestamp: number): string {
  const message = `${String(timestamp)}.${payload}`;
  return createHmac('sha256', secret).update(message).digest('hex');
}
```

### 5.2 Update HeartbeatConfig interface

```typescript
export interface HeartbeatConfig {
  codeAgentUrl: string;
  orchestratorSecret: string;
  intervalMs: number;
  getRunningTasks: () => string[];
}
```

### 5.3 Wire heartbeat in start.ts

**File:** `workers/orchestrator/src/start.ts`

Add import:

```typescript
import { createHeartbeatManager } from './heartbeat.js';
```

After creating dispatcher, add:

```typescript
const heartbeatManager = createHeartbeatManager(
  {
    codeAgentUrl: config.codeAgentUrl,
    orchestratorSecret: config.orchestratorSecret,
    intervalMs: 10 * 60 * 1000, // 10 minutes
    getRunningTasks: () => dispatcher.getRunningTaskIds(),
  },
  logger
);

// Start heartbeat when server starts
heartbeatManager.start();
```

### 5.4 Add getRunningTaskIds to TaskDispatcher

**File:** `workers/orchestrator/src/services/task-dispatcher.ts`

Add method:

```typescript
getRunningTaskIds(): string[] {
  return Array.from(this.activeTasks.keys());
}
```

### 5.5 Update code-agent /internal/code/heartbeat endpoint

**File:** `apps/code-agent/src/routes/codeRoutes.ts`

Verify the endpoint (around line 1902) uses HMAC authentication, not X-Internal-Auth.

If it uses X-Internal-Auth, update to use the same HMAC validation pattern as task-complete webhook.

### 5.6 Update tests

**File:** `workers/orchestrator/src/__tests__/heartbeat.test.ts`

Update tests to use new config interface and HMAC authentication.

### 5.7 Verification

```bash
pnpm run ci:tracked
```

---

## Checkpoint 6: Remove Firebase from Orchestrator

**Goal:** Clean up any remaining Firebase/Firestore references.

### 6.1 Remove dependencies

**File:** `workers/orchestrator/package.json`

Remove:

```json
"firebase-admin": "..."
```

### 6.2 Verify no Firebase imports remain

```bash
grep -r "firebase" workers/orchestrator/src/
grep -r "firestore" workers/orchestrator/src/
# Both should return 0 results
```

### 6.3 Update documentation

**File:** `workers/orchestrator/README.md`

Update architecture diagram to show HTTP-only communication.

Remove any references to Firestore.

### 6.4 Verification

```bash
pnpm install  # Regenerate lockfile without firebase-admin
pnpm run ci:tracked
```

---

## Checkpoint 7: End-to-End Testing

**Goal:** Verify complete flow works.

### 7.1 Local testing

1. Start code-agent locally
2. Start orchestrator locally with env vars:
   ```
   INTEXURAOS_CODE_AGENT_URL=http://localhost:3001
   INTEXURAOS_ORCHESTRATOR_SECRET=test-secret
   ```
3. Trigger a task dispatch
4. Verify:
   - Logs appear in Firestore via HTTP (check code-agent logs)
   - Heartbeats are sent every 10 minutes
   - Task completion webhook works

### 7.2 Integration test

Create integration test that:

1. Mocks code-agent endpoints
2. Starts orchestrator
3. Dispatches task
4. Verifies HTTP calls made with correct signatures

### 7.3 Verification

```bash
pnpm run ci:tracked
```

---

## Files Changed Summary

| File                                                 | Changes                                          |
| ---------------------------------------------------- | ------------------------------------------------ |
| `workers/orchestrator/src/start.ts`                  | Remove Firebase, add codeAgentUrl, rename secret |
| `workers/orchestrator/src/services/log-forwarder.ts` | HTTP instead of Firestore                        |
| `workers/orchestrator/src/heartbeat.ts`              | HMAC auth, wire into production                  |
| `workers/orchestrator/src/routes.ts`                 | Rename dispatchSecret                            |
| `workers/orchestrator/src/types/config.ts`           | Add codeAgentUrl, rename secret                  |
| `workers/orchestrator/package.json`                  | Remove firebase-admin                            |
| `workers/orchestrator/README.md`                     | Update architecture                              |
| `apps/code-agent/src/routes/webhookRoutes.ts`        | Verify HMAC auth on /internal/logs               |
| `apps/code-agent/src/routes/codeRoutes.ts`           | Verify HMAC auth on /internal/code/heartbeat     |
| `apps/web/src/pages/WorkerSettingsPage.tsx`          | Rename UI labels                                 |
| `terraform/environments/dev/main.tf`                 | Rename env var, add CODE_AGENT_URL               |
| `ecosystem.config.cjs`                               | Rename env var, add CODE_AGENT_URL               |

---

## Rollback Plan

If issues occur:

1. Revert to previous commit
2. Re-deploy orchestrator with Firebase access
3. Investigate logs

---

## Success Criteria

- [ ] Orchestrator has no Firebase/Firestore imports
- [ ] All HTTP calls use HMAC with `INTEXURAOS_ORCHESTRATOR_SECRET`
- [ ] Logs flow via HTTP to code-agent
- [ ] Heartbeat runs every 10 minutes
- [ ] `pnpm run ci:tracked` passes
- [ ] End-to-end test passes
