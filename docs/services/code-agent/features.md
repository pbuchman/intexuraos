# Code Agent - Features

> Autonomous code execution powered by Claude AI, dispatched to your own worker machines.

## The Problem

Software teams spend significant time on repetitive coding tasks: implementing well-defined features from Linear issues, fixing bugs with clear reproduction steps, refactoring code, and addressing PR review comments. Each task requires context-switching, environment setup, and manual execution -- even when the requirements are clearly specified.

When a code task fails or produces incomplete results, developers must manually retry from scratch, losing the context of what went wrong. When a PR receives review comments, someone must manually read, understand, and implement the requested changes.

## How Code Agent Helps

Code Agent bridges the gap between task specification and code execution. You describe what you want in natural language (or link a Linear issue), and Code Agent dispatches the work to a Claude-powered worker running on your own infrastructure. The worker analyzes your codebase, implements changes, runs tests, and creates pull requests -- all while streaming live logs back to your dashboard.

### 1. Submit-and-Forget Code Tasks

Submit a coding task through the web UI or WhatsApp. Code Agent handles everything: creates a Linear issue (or links an existing one), validates rate limits, dispatches to your configured worker, and notifies you when the work completes.

**Example:** You submit "Add pagination support to the /bookmarks endpoint with cursor-based navigation" from the web UI. Code Agent creates a Linear issue with an LLM-generated title ("Add cursor-based pagination to bookmarks"), dispatches the task to your Mac worker, and sends a WhatsApp notification with a cancel button when work begins. Fifteen minutes later, you receive another notification with a link to the PR.

### 2. Multi-Layer Deduplication

Code Agent prevents duplicate work through three deduplication layers:

- **Layer 0 (Approval Event ID):** Prevents replayed approval messages from creating duplicate tasks.
- **Layer 1 (Action ID):** Prevents Pub/Sub retries from spawning parallel tasks for the same action.
- **Layer 2 (Dedup Key):** Uses `sha256(userId + prompt)` to catch rapid double-taps from the UI.

**Example:** You accidentally click "Submit" twice within a second. The second request returns a `409 CONFLICT` with the ID of the already-created task instead of launching a duplicate worker session.

### 3. GitHub PR Comment Auto-Response

When someone comments on a PR that Code Agent created, the service can automatically create a follow-up task. It detects `@claude` mentions or request patterns from the PR author, acquires a per-PR lock to prevent concurrent modifications, and dispatches a new task with full context from the original work.

**Example:** A reviewer comments "@claude please add error handling for the edge case where the user ID is missing" on your PR. Code Agent creates a follow-up task with the original task context (Linear issue, branch, previous work summary) and dispatches it. The worker pushes fixes to the existing branch.

### 4. Per-User Worker Infrastructure

Each user configures their own worker machines (Mac Mini, VM, etc.) with Cloudflare Access credentials and HMAC signing secrets. Code Agent stores credentials encrypted at rest and supports up to 2 workers per user with configurable priority ordering and health probing.

**Example:** You configure a Mac Mini at home (`home-mac`) as primary and a cloud VM (`cloud-vm`) as fallback. When `home-mac` returns HTTP 503 (busy), Code Agent automatically falls back to `cloud-vm`.

### 5. Rich GitHub PR Activity Timeline

Every pull request created by Code Agent gets a live activity feed on your dashboard. The timeline shows PR opens, pushes, reviews, and comments -- each with a clickable link directly to that event on GitHub. When someone pushes new commits to the branch, a compare link shows exactly what changed.

Comment edits are automatically deduplicated: you see each comment once at its original position, but with the latest text. The PR description appears only on the most recent event so it does not repeat with every push.

**Example:** You push three commits to a Code Agent PR over the course of a review cycle. The timeline shows the original PR open (with description), three "synchronize" entries each linking to the exact diff for that push, two reviewer comments (showing the latest text if edited), and a review approval -- all in chronological order without repetition.

### 6. Retry, Feedback, and Mid-Task Messaging

Failed or cancelled tasks can be retried with optional additional context. Completed tasks can receive follow-up feedback that creates a new task linked to the original, carrying forward the Linear issue, branch, and prior work summary. Running tasks can receive mid-session messages that are queued and delivered at the next turn boundary.

**Example (retry):** A task fails because a test was flaky. You click "Retry" and add context: "The flaky test is in `auth.test.ts` -- skip it and add a note." Code Agent creates a retry task with a 5-minute cool-off period, updates the Linear issue to In Progress, and adds a comment documenting the retry.

**Example (mid-task message):** While a task is running, you realize the implementation needs a constraint. You send "Also validate that the limit parameter is between 1 and 100." Code Agent queues the message in Firestore. When the worker finishes its current turn, it picks up the queued message and continues with the additional instruction.

**Example (resume):** A task completed but you want one more change. You send a message to the completed task. Code Agent re-dispatches it to the worker with `--continue`, picking up where it left off on the same branch.

## Use Case Walkthrough: From WhatsApp to PR

1. You send a WhatsApp message: "Fix the login redirect that loops on Safari."
2. The actions-agent classifies it as a `code` action and sends it for approval.
3. You approve via WhatsApp. The actions-agent calls `POST /internal/code/process`.
4. Code Agent checks rate limits (3 concurrent, 10/hour, $20/day, $200/month).
5. Code Agent calls the linear-agent to generate a title ("Fix Safari login redirect loop") and creates a Linear issue. Phase 1 (design) begins — the agent enriches the issue and adds the `code-task` label when the design is ready.
6. The task document lands in Firestore with deduplication checks passing.
7. Code Agent signs the dispatch request with HMAC and sends it to your primary worker via Cloudflare Access.
8. You receive a WhatsApp message: "Task started on home-mac. Cancel: reply `cancel a1b2`."
9. The worker streams log chunks back to `POST /internal/logs`. The web UI shows a live terminal.
10. On completion, the worker calls `POST /internal/webhooks/task-complete` with the PR URL.
11. Code Agent updates the Linear issue to "In Review," notifies the actions-agent, and sends a WhatsApp message with the PR link.

## Key Benefits

| Benefit                  | Detail                                                                       |
| ------------------------ | ---------------------------------------------------------------------------- |
| Your infrastructure      | Workers run on your machines. Code never leaves your environment.            |
| End-to-end tracing       | Every task carries a `traceId` from submission through completion.           |
| Cost controls            | Per-user daily ($20) and monthly ($200) caps with real-time enforcement.     |
| Zombie detection         | Tasks inactive for 30 minutes are automatically interrupted.                 |
| Log retention management | Logs older than 90 days are archived automatically.                          |
| Turn-level metrics       | CPU time, memory, token counts, and API wait times recorded per worker turn. |

## Limitations

- Maximum 2 workers per user (configurable at the model level).
- Maximum 3 concurrent tasks per user.
- Prompt sanitization is not yet implemented (uses raw prompt).
- System prompt hash is currently a static placeholder.
- PR comment auto-dispatch (`handlePRComment`, Phase 4) prepares tasks and logs them but does not yet dispatch to a worker.
- Tasks complete as `designed` (Phase 1) or `implemented` (Phase 2), not as a generic `completed` status.
- Workers require Cloudflare Access tunnels for secure connectivity.
- GLM model support (`workerType: 'glm'`) depends on external Z.ai availability.

---

_Part of [IntexuraOS](../../overview.md)_
