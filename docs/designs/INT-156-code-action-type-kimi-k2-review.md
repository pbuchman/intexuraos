# INT-156: Code Action Type - Design Review

## Overview

This review analyzes the design document `docs/designs/INT-156-code-action-type.md` against the current codebase and project architecture. The proposed design introduces a new `code` action type, a dedicated `code-agent` service, and an `orchestrator` worker system to execute coding tasks via Claude Code.

## Current Architecture Context

- **WhatsApp Service:** Ingests messages.
- **Commands Agent:** Classifies messages using `commandClassifierPrompt` (in `llm-common`) and creates actions via `actions-agent`.
- **Actions Agent:** Handles specific action logic (`research`, `todo`, `linear`, etc.) and manages approvals/execution.
- **Linear Agent:** Manages Linear issues.

## Identified Gaps

### A. Classification Gaps (Confirmed)

The design correctly identifies that the `code` classification is missing.

- **Location:** `packages/llm-common/src/classification/commandClassifierPrompt.ts`
- **Gap:** The prompt currently handles `todo`, `research`, `note`, `link`, `calendar`, `reminder`, `linear`. It has no knowledge of `code` or execution intents.
- **Gap:** `apps/commands-agent/src/infra/llm/classifier.ts` has a hardcoded `VALID_TYPES` list that excludes `code`.
- **Impact:** The system cannot currently classify user requests as code tasks.

### B. Actions Agent Logic Gaps

The `actions-agent` uses a registry of handlers for each action type.

- **Location:** `apps/actions-agent/src/services.ts`
- **Gap:** Missing `handleCodeActionUseCase` (for initial processing/approval) and `executeCodeActionUseCase` (for dispatching to `code-agent`).
- **Gap:** The `retryPendingActionsUseCase` and dynamic routing logic need to be updated to include the `code` handler.
- **Gap:** `apps/actions-agent/src/domain/models/action.ts` needs to be updated to include `'code'` in the `ActionType` union type.

### C. Infrastructure & Deployment Gaps

- **Orchestrator Update Mechanism:** The design specifies "Deploy via git pull on worker machines".
  - **Risk:** This is manual and error-prone.
  - **Recommendation:** Use a simple self-update script or a systemd service that checks for updates on restart, coupled with the "Emergency Shutdown" feature to force restarts.
- **VM Lifecycle:**
  - **Risk:** "Race condition: task dispatched during shutdown". The design handles this via 503s, but a graceful shutdown signal from the Cloud Function to the Orchestrator (before killing the VM) would be safer.
- **Secrets Management:**
  - **Observation:** Secrets are stored in GCP Secret Manager, which is good. The orchestrator needs access to these, requiring the VM service account to have proper IAM roles.

### D. Operational Gaps

- **Zombie Tasks:** If a worker machine dies catastrophically (kernel panic, power loss, or forced VM deletion) without sending a final webhook, tasks remain "running" in Firestore.
  - **Mitigation:** The design mentions "State reconciliation" where `code-agent` polls stale tasks. This is a crucial feature that must be implemented robustly.
- **Logs:**
  - **Risk:** Streaming raw stdout/stderr to Firestore might hit document size limits (1MB) or write rate limits if the tool output is massive (e.g., `cat package-lock.json`).
  - **Recommendation:** Ensure the chunking strategy strictly enforces size limits and perhaps drops middle chunks if logs are excessive, preserving head/tail.

## Potential Improvements

1.  **Unified Action Handler Interface:** The `actions-agent` seems to have a lot of boilerplate for each action type. Introducing a more generic handler interface or middleware for common steps (logging, publishing events) could reduce code duplication.

2.  **Prompt Injection & Safety:**
    - **Refinement:** The design mentions sanitization. It is critical to ensure that the `user_request` cannot break out of the XML tags in the worker system prompt.
    - **Recommendation:** Use a robust XML escaping library rather than simple string replacement, or strictly validate the input charset.

3.  **Deduplication:**
    - **Refinement:** The 5-minute deduplication window is smart. Ensure this logic is applied _before_ the expensive LLM classification step if possible, or at least before the action creation step.

4.  **"Run Again" vs "Retry":**
    - **Refinement:** The distinction is clear in the design. "Retry" re-uses the intent for a failed task, "Run Again" creates a fresh task from a completed one. This is a good UX pattern.

5.  **Linear Fallback:**
    - **Refinement:** The design's "Fallback Flow (without Linear)" is a necessary evil. However, if the Linear API is down, maybe the system should _queue_ the task rather than proceeding without tracking, or at least ask the user for confirmation ("Linear is down. Proceed without tracking?"). Proceeding blindly might create a "shadow IT" problem where code changes aren't tracked.

## Implementation Plan Adjustments

1.  **Phase 1:** Update `llm-common` and `commands-agent` to support `code` classification.
2.  **Phase 2:** Implement `actions-agent` handlers (`handleCodeAction`, `executeCodeAction`) and update `ActionType`.
3.  **Phase 3:** Build `code-agent` (Cloud Run).
4.  **Phase 4:** Build `orchestrator` and `vm-lifecycle`.
5.  **Phase 5:** Infrastructure (Terraform) and Secrets.

This order ensures that we can test the flow up to the `code-agent` boundary before the complex worker infrastructure is ready.
