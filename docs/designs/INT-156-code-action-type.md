# INT-156: Code Action Type Design

Execute Claude Code tasks from inbox actions.

**Status:** Design in progress
**Linear Issue:** [INT-156](https://linear.app/pbuchman/issue/INT-156/action-type-code-execute-claude-code-tasks-from-inbox-actions)
**Last Updated:** 2026-01-24

---

## Overview

New action type "code" that allows users to approve an action in the inbox and receive a pull request with the requested changes. The changes are described either in a linked Linear task or directly in the action's command description.

### User Flow

1. User (or system) creates an action with type `code`
2. Action appears in inbox with description of code changes needed
3. User clicks "Approve" on the action
4. System executes Claude Code on worker machine (MacBook primary, GCP VM fallback)
5. User can monitor progress in real-time on `/code-tasks` page
6. User receives a PR with the implemented changes (WhatsApp notification)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  GCP (intexuraos)                                                           │
│  ┌─────────────┐     ┌───────────────┐     ┌──────────────┐                │
│  │  Inbox UI   │────▶│ actions-agent │────▶│  code-agent  │                │
│  │  (approve)  │     │  (Cloud Run)  │     │  (Cloud Run) │                │
│  └─────────────┘     └───────────────┘     └──────┬───────┘                │
│                                                    │                        │
│  ┌─────────────┐     ┌──────────────────┐         │                        │
│  │ /code-tasks │     │  Cloud Function  │         │                        │
│  │    (PWA)    │     │  (VM lifecycle)  │◀────────┤                        │
│  └─────────────┘     └──────────────────┘         │                        │
│        ▲                                          │                        │
│        │ Firestore real-time                      │                        │
└────────┼──────────────────────────────────────────┼────────────────────────┘
         │                                          │
         │                               Cloudflare │ Tunnel + Access
         │                                          │
┌────────┼──────────────────────────────────────────┼────────────────────────┐
│        │              WORKER MACHINES             │                        │
│        │                                          ▼                        │
│  ┌─────┴─────────────────────────────────────────────────────────────────┐ │
│  │  MacBook (cc-mac.intexuraos.cloud) — PRIMARY                         │ │
│  │  ┌─────────────────────────────────────────────────────────────────┐ │ │
│  │  │  Orchestrator (Node.js)                                         │ │ │
│  │  │  ├── HTTP API (:8080)                                           │ │ │
│  │  │  ├── Task dispatcher (max 5 concurrent)                         │ │ │
│  │  │  ├── tmux session manager (session per task)                    │ │ │
│  │  │  ├── Worktree manager (worktree per task)                       │ │ │
│  │  │  ├── Log chunk forwarder                                        │ │ │
│  │  │  ├── GitHub token refresh (every 45 min)                        │ │ │
│  │  │  ├── PR discovery and creation                                  │ │ │
│  │  │  └── Local state persistence                                    │ │ │
│  │  └─────────────────────────────────────────────────────────────────┘ │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │  GCP VM (cc-vm.intexuraos.cloud) — FALLBACK                          │ │
│  │  n2d-standard-8 (8 vCPU, 32GB) | Spot | Ubuntu 24 LTS                │ │
│  │  Same orchestrator structure as MacBook                               │ │
│  │  Auto-shutdown on idle | Manual start/stop from UI                   │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## End-to-End Flow

```
WhatsApp message: "fix the login bug"
         ↓
[whatsapp-service] webhook receives message
         ↓ Pub/Sub: command.ingest
[commands-agent] classifies via LLM
         ↓ Classification: type=code, confidence=0.9
[actions-agent] creates action (status: pending)
         ↓ Handler: handleCodeAction
[actions-agent] sends approval message to WhatsApp
         ↓ User responds: 👍
[actions-agent] receives approval
         ↓ Execute action
[code-agent] creates Linear issue via linear-agent  ← NEW
         ↓ Returns linearIssueId
[code-agent] dispatches to orchestrator (HTTP via Cloudflare Tunnel)
         ↓ Action status: completed (handed off)
[orchestrator] creates worktree, starts tmux session
         ↓ Claude invokes /linear INT-XXX (mandatory)
[Claude] implements changes, runs CI, creates PR
         ↓ Webhook: task-complete
[code-agent] updates code_tasks, sends WhatsApp notification
         ↓
User receives: "✅ Code task completed: Fix login bug — PR: https://..."
```

---

## Design Decisions

### Classification (Gap A)

**Decision:** User explicitly requests execution.

| Phrase Pattern | Classification |
|----------------|----------------|
| "Fix it", "do it", "implement this", "build", "refactor" | `code` |
| "Create issue for...", "track...", "log this bug" | `linear` |
| "Remember to...", "add to my list" | `todo` |

Key insight: "code" means user wants EXECUTION, not just tracking.

### Linear Issue Creation (Gap B)

**Decision:** Always create Linear issue first.

Flow:
1. User: "fix the login bug"
2. Classified as: code action
3. code-agent creates Linear issue via linear-agent
4. code-agent dispatches to orchestrator with `linearIssueId`
5. Claude invokes `/linear INT-XXX` (handles branch, PR, state transitions)

Benefits:
- Every code task has tracking
- PR cross-linking works automatically
- `/linear` skill handles full workflow
- No orphaned PRs without issues

### Action/Task Status Separation (Gap C)

**Decision:** Clean separation between actions-agent and code-agent.

| Component | Responsibility | Status Lifecycle |
|-----------|---------------|------------------|
| actions-agent | Dispatch to code-agent | `pending` → `processing` → `completed` (on accept) |
| code-agent | Track execution | `dispatched` → `running` → `completed/failed` |

Action is "done" once successfully handed off. Execution tracking is code-agent's domain.

### Approval UX (Gap D)

**Decision:** MVP defaults to AUTO worker type.

| Entry Point | Worker Type |
|-------------|-------------|
| Inbox (WhatsApp) | Always `auto` (default) |
| `/code-tasks/new` UI | User selects (opus/auto/glm) |

Future enhancements:
- [INT-217](https://linear.app/pbuchman/issue/INT-217): Keyword detection for worker type

### /linear Skill Invocation (Gap E)

**Decision:** code-agent creates issue, skill auto-invoked.

Flow:
1. code-agent calls linear-agent to create Linear issue
2. code-agent stores `linearIssueId` in `code_tasks` record
3. code-agent dispatches to orchestrator with `linearIssueId`
4. Worker system prompt MANDATES `/linear INT-XXX` as first action
5. Claude executes skill → handles branch, PR, state transitions

System prompt:
```
[MANDATORY - FIRST ACTION]
You MUST invoke: /linear INT-{{linearIssueId}}
DO NOT proceed with any other action until this completes.
```

### Branch Naming

**Decision:** Include taskId for uniqueness.

| Scenario | Branch Pattern |
|----------|----------------|
| With Linear | `fix/INT-303-{taskId}` |
| Without Linear | `fix/{taskId}-{slug}` |

This ensures:
- Multiple tasks for same issue don't collide
- Tasks without Linear issues have unique branches
- taskId is always available (Firestore doc ID)

### PR Creation Responsibility

**Decision:** `/linear` skill creates PR. Orchestrator only verifies.

| Concern | Owner |
|---------|-------|
| Branch creation | `/linear` skill |
| State transitions (Linear) | `/linear` skill |
| PR creation | `/linear` skill |
| PR discovery (verification) | Orchestrator (fallback only) |

If `/linear` skill failed to create PR, orchestrator marks task as "failed" with error. No automatic PR creation fallback.

---

## Infrastructure

### Monorepo Structure

```
workers/
├── orchestrator/              # Runs on Mac/VM
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.ts           # Entry point
│   │   ├── api/               # HTTP endpoints
│   │   ├── services/          # Task dispatcher, tmux, worktree
│   │   ├── github/            # Token refresh, PR discovery
│   │   └── config/            # Settings file switching
│   └── scripts/
│       └── start.sh           # Wrapper for production
│
└── vm-lifecycle/              # Cloud Function
    ├── package.json
    ├── tsconfig.json
    └── src/
        ├── index.ts           # Function entry points
        ├── start-vm.ts        # Start VM + poll health
        └── stop-vm.ts         # Stop VM
```

### Orchestrator Deployment

Deploy via git pull on worker machines:
```bash
cd ~/claude-workers/repos/intexuraos
git pull origin development
pnpm install --frozen-lockfile
pnpm --filter orchestrator build
pnpm --filter orchestrator start
```

### GCP VM Configuration

| Setting | Value |
|---------|-------|
| Machine Type | n2d-standard-8 (8 vCPU, 32GB) |
| Provisioning | Spot instance |
| OS | Ubuntu 24 LTS |
| Provisioning | Terraform + startup script |
| Secrets | Fetched from Secret Manager |

### Secret Manager

Secrets stored in GCP Secret Manager:

| Secret Name | Purpose |
|-------------|---------|
| `cloudflare-tunnel-token-mac` | Mac tunnel auth |
| `cloudflare-tunnel-token-vm` | VM tunnel auth |
| `linear-api-key` | Linear MCP |
| `sentry-auth-token` | Sentry MCP |
| `zai-api-key` | GLM worker type |
| `github-app-private-key` | GitHub App for PRs |

Startup script fetches secrets:
```bash
LINEAR_API_KEY=$(gcloud secrets versions access latest --secret="linear-api-key")
echo "export LINEAR_API_KEY='$LINEAR_API_KEY'" >> ~/.zshrc
```

### Cloudflare Tunnel Setup

One-time manual setup (free tier):
1. Go to Cloudflare Zero Trust → Access → Tunnels
2. Create tunnel: `cc-mac` and `cc-vm`
3. Copy tunnel tokens
4. Store in GCP Secret Manager

Startup script installs cloudflared:
```bash
TOKEN=$(gcloud secrets versions access latest --secret="cloudflare-tunnel-token-vm")
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared
chmod +x /usr/local/bin/cloudflared
cloudflared service install $TOKEN
```

### Terraform Resources

| Category | Resources |
|----------|-----------|
| code-agent | Cloud Run service, service account, IAM |
| GCP VM | google_compute_instance (spot), google_service_account, IAM |
| Cloud Function | google_cloudfunctions2_function, IAM |
| Secrets | google_secret_manager_secret (6 secrets), IAM bindings |
| Firestore | Just register `code_tasks` in `firestore-collections.json` |
| Pub/Sub | None new (HTTP only) |

---

## Worker Configuration

### Required Environment Variables

```bash
export LINEAR_API_KEY="lin_api_..."      # Required
export SENTRY_AUTH_TOKEN="sntrys_..."    # Required
export ZAI_API_KEY="..."                 # Required for glm worker type
```

### MCP Servers

Each worktree gets `.mcp.json` copied from template:

```json
{
  "mcpServers": {
    "linear": {
      "type": "http",
      "url": "https://mcp.linear.app/mcp",
      "headers": {
        "Authorization": "Bearer ${LINEAR_API_KEY}"
      }
    },
    "sentry": {
      "command": "npx",
      "args": ["@sentry/mcp-server@latest", "--access-token", "${SENTRY_AUTH_TOKEN}"]
    }
  }
}
```

### Worker System Prompt

```
[SYSTEM CONTEXT]
You are a Claude Code worker in IntexuraOS.
Machine: {mac|vm} | Worktree: {path} | Task ID: {taskId}

[MANDATORY - FIRST ACTION]
You MUST invoke: /linear INT-{{linearIssueId}}
DO NOT proceed with any other action until this completes.

[GIT WORKFLOW]
Worktree starts at: {baseBranch} (default: development)
Target: development (unless overridden)
Branch naming: fix/INT-XXX-{taskId} or feature/INT-XXX-{taskId}

[NON-NEGOTIABLE]
Every task MUST result in a PR.

Before completing, create investigation file:
  docs/investigations/{linearIssueId}-{slug}.md

[TASK]
{user prompt}
```

---

## API Contracts

### Orchestrator HTTP API

**POST /tasks** — Submit new task
```typescript
Request: {
  taskId: string;                // Firestore document ID
  workerType: 'opus' | 'auto' | 'glm';
  prompt: string;
  repository?: string;           // default: pbuchman/intexuraos
  baseBranch?: string;           // default: development
  linearIssueId?: string;
  linearIssueTitle?: string;
  webhookUrl: string;
  webhookSecret: string;
  actionId?: string;
}
Response 202: { status: 'accepted', taskId }
Response 503: { status: 'rejected', reason: 'capacity_reached' }
```

**GET /tasks/:taskId** — Get task status
```typescript
Response: {
  taskId: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'interrupted' | 'cancelled';
  startedAt?: string;
  completedAt?: string;
  result?: { prUrl?, branch, commits, summary };
  error?: { code, message };
}
```

**GET /health** — Health check
```typescript
Response: {
  status: 'ready';
  capacity: 5;
  running: number;
  available: number;
  githubTokenExpiresAt: string;
}
```

### code-agent HTTP API

**POST /internal/code/process** — Called by actions-agent
```typescript
Request: { actionId, payload: CodeActionPayload }
Response 200: { status: 'submitted', codeTaskId }
Response 503: { status: 'failed', error: 'worker_unavailable' }
```

**POST /code/submit** — Direct submission from UI
```typescript
Request: {
  prompt: string;
  workerType: 'opus' | 'auto' | 'glm';
  linearIssueId?: string;
}
Response 200: { status: 'submitted', codeTaskId }
```

**POST /internal/webhooks/task-complete** — Called by orchestrator
```typescript
Headers: X-Request-Timestamp, X-Request-Signature (HMAC-SHA256)
Request: { taskId, status, result?, error?, duration }
Response 200: { received: true }
```

---

## Firestore Collections

### code_tasks

```typescript
interface CodeTask {
  id: string;
  actionId?: string;
  userId: string;
  workerType: 'opus' | 'auto' | 'glm';
  workerLocation: 'mac' | 'vm';
  status: 'dispatched' | 'running' | 'completed' | 'failed' | 'interrupted' | 'cancelled';
  prompt: string;
  repository: string;
  baseBranch: string;
  linearIssueId?: string;
  linearIssueTitle?: string;
  result?: { prUrl?, branch, commits, summary };
  error?: { code, message };
  createdAt: Timestamp;
  dispatchedAt?: Timestamp;
  completedAt?: Timestamp;
  callbackReceived: boolean;
}
```

### code_tasks/{taskId}/logs

```typescript
interface LogChunk {
  id: string;
  sequence: number;
  content: string;
  timestamp: Timestamp;
  size: number;
}
```

---

## Design Review: 20 Questions Session

### Summary

| Result | Count |
|--------|-------|
| Confirmed/Decided | 13 |
| Gaps Found | 6 |

### Confirmed Decisions

| # | Scenario | Decision |
|---|----------|----------|
| 1 | Multiple concurrent tasks from same user | Both run, user gets multiple PRs |
| 2 | Cross-machine retry with existing branch | VM checks out existing remote branch |
| 3 | Orphaned Linear issue on dispatch failure | Issue stays in Backlog, user retries |
| 4 | CI failure during task | Claude fixes per CLAUDE.md ownership rules |
| 8 | WhatsApp notification on completion | Confirmed (already in design) |
| 9 | Token refresh race with git push | Claude retries on transient auth errors |
| 10 | Quota exhausted handling | Task fails with clear "quota exhausted" message |
| 11 | Cancel during git operation | Worktree left dirty, preserved |
| 14 | Scope creep (massive task) | Work until timeout, create partial PR |
| 15 | Auto-shutdown with queued task | No queue; reject immediately, retry mechanism handles |
| 16 | Wrong repo mentioned | Single repo (intexuraos) for MVP, ignore other mentions |
| 18 | Routing mode constraint + offline | Task rejected with clear message |

### Open Gaps (Need Resolution)

#### Gap K: Race between timeout and webhook completion

**Scenario:** Task times out at 2 hours. But Claude created PR 5 minutes before timeout and webhook was delayed/lost.

**Problem:** Task shows "failed" but PR exists. User confused.

**Options:**
1. code-agent polls orchestrator after timeout to check actual state
2. Extend timeout grace period for webhook delivery
3. Orchestrator marks completion BEFORE creating PR (optimistic)
4. Add reconciliation job that checks for mismatched states

---

#### Gap L: Orchestrator startup depends on code-agent availability

**Scenario:** Orchestrator restarts. Finds orphan worktrees. Tries to query code-agent for task status. code-agent is down.

**Problem:** Circular dependency. Can't start cleanly if code-agent unavailable.

**Options:**
1. Retry with backoff (blocks startup)
2. Start anyway, reconcile later (may cause issues)
3. Local state is source of truth for orphan handling
4. Persist last-known code-agent state locally

---

#### Gap M: Retry semantics after successful completion

**Scenario:** Task completes successfully. PR created. User clicks 'Retry'.

**Questions:**
- Should retry be allowed after success?
- If yes, what does it do? Fresh task? Continue on same branch?
- If no, should button be hidden/disabled?

**Options:**
1. Disable retry button for completed tasks
2. Retry creates NEW task (new Linear issue, new branch)
3. Retry continues on same branch (adds more commits to existing PR)
4. Rename to "Run Again" with different semantics

---

#### Gap N: /linear skill doesn't handle already-Done issues

**Scenario:** Task dispatched for INT-305. While queued, someone manually closes the issue (status: Done). Claude invokes `/linear INT-305`.

**Problem:** Skill probably moves it to In Progress, overriding the manual close.

**Recommendation:** If status is Done or Cancelled, stop task and report. Don't override manual decisions.

**Update needed in:** `/linear` skill `work-existing.md` workflow

---

#### Gap O: MCP server health and lifecycle not specified

**Scenario:** Claude uses Sentry MCP during task. MCP server (npx process) crashes. Claude's queries hang/fail.

**Questions:**
1. How are MCP servers started? (Claude Code handles this?)
2. What if MCP server crashes mid-task?
3. Should orchestrator monitor MCP health?
4. Should orchestrator restart crashed MCPs?

**Options:**
1. Rely on Claude Code's MCP management (black box)
2. Orchestrator monitors and restarts MCP processes
3. Accept MCP failures as non-fatal (Claude works around)

---

## Related Issues

| Issue | Description |
|-------|-------------|
| [INT-216](https://linear.app/pbuchman/issue/INT-216) | Rename gemini/ directory to llm/ in commands-agent |
| [INT-217](https://linear.app/pbuchman/issue/INT-217) | Keyword detection for worker type in code actions |

---

## Implementation Phases

See Linear issue INT-156 for detailed phase breakdown (16 phases).

**Key phases:**
- Phase 0: Cloudflare Setup
- Phase 1: GitHub App Setup
- Phase 2-4: Worker Machine Setup
- Phase 5: Orchestrator Development
- Phase 6: Cloud Function Development
- Phase 7: code-agent Service
- Phase 8-14: Integration and UI
- Phase 15: End-to-End Testing
- Phase 16: Documentation

---

## Next Steps

1. **Resolve open gaps (K, L, M, N, O)** — Continue design session
2. **Update /linear skill** — Branch naming with taskId, Done issue handling
3. **Update classifier prompt** — Add "code" action type recognition
4. **Begin Phase 0** — Cloudflare account and tunnel setup
