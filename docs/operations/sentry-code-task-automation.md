# Sentry Code Task Automation

This runbook covers the Sentry integration that turns actionable Sentry issues
into autonomous IntexuraOS code tasks.

The invariant is intentionally strict: a Sentry task cannot complete
successfully without a GitHub pull request. The PR must either fix the bug or
add code-level suppression for a report that is clearly not an application
error. Do not resolve this automation path by muting, ignoring, or resolving the
issue only in Sentry.

## Public Endpoint

Register the code-agent webhook URL with Sentry:

| Environment | Webhook URL |
| --- | --- |
| Production | `https://intexuraos.cloud/api/code/webhooks/sentry` |
| Development | `https://dev.intexuraos.cloud/api/code/webhooks/sentry` |

The route accepts Sentry Integration Platform webhook deliveries with:

- `Sentry-Hook-Signature`: HMAC-SHA256 signature generated from the Sentry
  integration client secret and the raw request body.
- `Sentry-Hook-Resource`: supported values are `issue` and `event_alert`.

Reference: Sentry documents webhook signatures on the Integration Platform
webhooks page and issue-alert deliveries on the Issue Alerts webhook page:

- <https://docs.sentry.io/integrations/integration-platform/webhooks/>
- <https://docs.sentry.io/integrations/integration-platform/webhooks/issue-alerts/>

## Sentry Setup

1. In Sentry, create an Internal Integration for IntexuraOS code automation.
2. Set the Webhook URL to the environment-specific endpoint above.
3. Enable the integration as an alert rule action so issue alert rules can send
   `event_alert` deliveries.
4. Enable webhook subscriptions for `issue` and issue alert / `event_alert`
   deliveries.
5. Grant read access for the Sentry data the worker needs to inspect:
   organization, project, issue/event details, and alert metadata.
6. Copy the Internal Integration Client Secret into
   `INTEXURAOS_SENTRY_WEBHOOK_SECRET`.
7. Create or provision a Sentry auth token for worker-side issue lookup and
   store it as `INTEXURAOS_SENTRY_AUTH_TOKEN`.

`INTEXURAOS_SENTRY_WEBHOOK_SECRET` verifies inbound webhook authenticity.
`INTEXURAOS_SENTRY_AUTH_TOKEN` is passed to worker containers as
`SENTRY_AUTH_TOKEN` so the Sentry MCP server, or REST API fallback, can fetch
current issue details and recent events.

## IntexuraOS Configuration

Code-agent requires:

| Variable | Purpose |
| --- | --- |
| `INTEXURAOS_SENTRY_WEBHOOK_SECRET` | Verifies `Sentry-Hook-Signature`. |
| `INTEXURAOS_SENTRY_AUTOMATION_USER_ID` | Code-agent user that owns automatically created Sentry tasks. |
| `INTEXURAOS_SENTRY_CODE_TASK_REPOSITORY` | Repository targeted by Sentry tasks. Defaults to `pbuchman/intexuraos`. |
| `INTEXURAOS_SENTRY_CODE_TASK_BASE_BRANCH` | Base branch for Sentry task PRs. Defaults to `development`. |

The orchestrator / worker runtime requires:

| Variable | Purpose |
| --- | --- |
| `INTEXURAOS_SENTRY_AUTH_TOKEN` | Secret read by orchestrator and injected into workers as `SENTRY_AUTH_TOKEN`. |
| `LINEAR_API_KEY` | Existing Linear MCP credential used by the worker for the linked Linear issue. |

Hetzner production loads `INTEXURAOS_SENTRY_WEBHOOK_SECRET`,
`INTEXURAOS_SENTRY_AUTOMATION_USER_ID`, and
`INTEXURAOS_SENTRY_AUTH_TOKEN` from GCP Secret Manager through
`scripts/hetzner/load-secrets.sh`. Development can mirror the same values from
`.envrc.local` / `.envrc.local.example`.

## Automation User And Worker Selection

1. Create or choose the code-agent user identified by
   `INTEXURAOS_SENTRY_AUTOMATION_USER_ID`.
2. Ensure that user has at least one enabled worker in Worker Settings.
3. Set the user's default Sentry worker type in the Worker Settings page, or via
   `PATCH /api/code/worker-settings/default-sentry-worker-type`.

Sentry tasks use `defaultSentryWorkerType`. They must not silently fall back to
the generic execution default unless `defaultSentryWorkerType` is intentionally
unset and the normal worker resolution fallback is desired for development.

## Expected Flow

1. Sentry sends a signed `issue` or `event_alert` webhook to code-agent.
2. Code-agent verifies `Sentry-Hook-Signature`.
3. Code-agent parses the Sentry org, project, issue ID, issue URL, title,
   action, event ID when present, and received time.
4. Code-agent persists an audit/dedupe record in `sentry-issue-events`.
5. Duplicate deliveries for the same Sentry issue return success without
   creating another task.
6. Code-agent creates or links the Linear issue for the Sentry issue.
7. Code-agent queues a CodeTask with `agentType: "sentry"` and the configured
   Sentry worker type.
8. The orchestrator dispatches the worker with Linear and Sentry access.
9. The worker fetches current Sentry issue details and recent events, attempts
   reproduction when feasible, and opens a PR.
10. Completion is rejected unless the worker reports a PR URL and the outcome is
    `fixed` or `suppressed`.

The task final result records the PR URL, Sentry issue URL, Linear issue ID,
outcome, and verification evidence.

## Verification

After changing the integration or its deployment config, run:

```bash
pnpm run ci:tracked
```

For a live smoke test:

1. Use Sentry's test delivery or trigger an issue alert for a low-risk project.
2. Confirm the Sentry integration delivery log shows a 2xx response.
3. Confirm code-agent stores one `sentry-issue-events` record for the Sentry
   issue.
4. Confirm one Linear issue is created or linked.
5. Confirm one queued CodeTask exists with `agentType: "sentry"`.
6. Confirm the task worker type matches the automation user's
   `defaultSentryWorkerType`.
7. Confirm the worker can fetch Sentry details using `SENTRY_AUTH_TOKEN`.
8. Confirm successful completion includes a PR URL and a final outcome of
   `fixed` or `suppressed`.

To test signature rejection locally, send the same payload with a bogus
`Sentry-Hook-Signature` and confirm code-agent returns `401`.

## Suppression Policy

Suppression is a code change, not a Sentry-side ignore. A suppression PR must
include:

- Sentry URL
- Linear issue
- why the report is clearly not an application error
- the code-level suppression change
- verification commands and results

If the report cannot be proven safe to suppress, fix the bug instead.
