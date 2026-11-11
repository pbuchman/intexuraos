# Code Agent Tutorial

## Create A Planning Task

Submit a task from the dashboard or Intex Agent:

```text
Create a code task to fix the login redirect on Safari
```

The task starts in planning mode by default. Review the generated design, then use the Implement action from the dashboard when the plan is ready.

## Create An Execution Task

Use execution mode only when you intentionally want implementation to start without a separate planning step:

```text
Create a code task in execution mode to update the billing copy
```

## Follow Progress

Open the code task detail page to watch logs, task status, worker model, Linear issue links, and PR automation events.

## Refine a Plan and Inspect Recovery

After a planning task finishes, send a follow-up message from its task page to refine the plan before implementation. The planning flow keeps one plan artifact and one evidence/planning PR.

For actionable error alerts, open the associated SentryBox code task and inspect its logs and issue links. Repeated alerts may reuse existing remediation work. In Dispatch Queue, inspect the reported blocker and next action; a review may wait for queued implementation on the same issue. Ask Agent opens an interactive Codex task.

## Inspect a Failed Investigation

Read the task failure reason and linked SentryBox or Linear evidence before retrying. `SENTRY_EVIDENCE_UNAVAILABLE` means the investigation stopped because the supported evidence could not justify a change; repeating it does not supply the missing evidence. For provider usage limits, check the preserved reset information when present. Retry exhaustion attempts one exhaustion notification, with a generic failure publish as fallback if that publish fails.

## Internal Submission

Trusted services should use the current internal task creation client from `@intexuraos/internal-clients`. Do not call removed compatibility endpoints.

The current internal route is `POST /internal/code/submit`. It creates a task on behalf of a user and accepts the same planning or execution mode choice as direct task submission.
