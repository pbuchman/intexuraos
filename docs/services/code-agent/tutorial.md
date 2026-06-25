# Code Agent Tutorial

## Create A Planning Task

Submit a task from the dashboard or Intex:

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

## Internal Submission

Trusted services should use the current internal task creation client from `@intexuraos/internal-clients`. Do not call removed compatibility endpoints.

