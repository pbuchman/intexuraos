# SentryBox Code Task Automation

This runbook covers the Sentry-compatible SentryBox integration that turns
actionable issues into autonomous IntexuraOS code tasks. Legacy Sentry SaaS is
not an active event source or worker evidence provider.

The invariant is intentionally strict: a Sentry task cannot complete
successfully without a GitHub pull request. The PR must either fix the bug or
add code-level suppression for a report that is clearly not an application
error. Do not resolve this automation path by muting, ignoring, or resolving the
issue only in Sentry.

## Public Endpoint

Register the code-agent webhook URL with SentryBox:

| Environment           | Webhook URL                                                   |
| --------------------- | ------------------------------------------------------------- |
| Production            | `https://intexuraos.cloud/api/code/webhooks/sentry`           |
| Retained DEV recovery | `https://dev.intexuraos.cloud/api/code/webhooks/sentry`       |

Only production forwarding is supported during normal operation. DEV forwarding remains disabled
while the retained runtime is hibernated; the recovery URL returns `503`. Enable it only inside a
separately authorized recovery drill, then disable it again before re-hibernation. Keep the DEV
ingest configuration and signing secret for reversibility; do not delete either one.

The compatibility route remains `/webhooks/sentry` and accepts SentryBox
deliveries with:

- `Sentry-Hook-Signature`: HMAC-SHA256 signature generated from the configured
  SentryBox webhook secret and the raw request body.
- `Sentry-Hook-Resource`: supported values are `issue` and `event_alert`.

SentryBox preserves this wire contract so the existing endpoint, payload parser,
and signature verification remain unchanged. The upstream protocol references
are:

- <https://docs.sentry.io/integrations/integration-platform/webhooks/>
- <https://docs.sentry.io/integrations/integration-platform/webhooks/issue-alerts/>

## SentryBox Setup

1. Retain the backend and web project definitions for both `dev` and `prod` in SentryBox.
2. Keep production forwarding pointed at its production endpoint. Keep DEV forwarding disabled
   unless the reviewed recovery procedure explicitly activates it.
3. Configure the webhook HMAC value to match
   `INTEXURAOS_SENTRY_WEBHOOK_SECRET` in that Code Agent environment.
4. Enable compatible `issue` and `event_alert` deliveries for new and regressed
   errors.
5. Keep SentryBox reachable from Code Workers only through the approved private
   network hostname.

`INTEXURAOS_SENTRY_WEBHOOK_SECRET` remains required because it verifies inbound
webhook authenticity. It is unrelated to worker-side evidence access and must
not be removed during the cutover.

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
| `INTEXURAOS_ERROR_HUB_HOST` | Private SentryBox `.ts.net:8443` host, injected into workers as `ERROR_HUB_HOST`. |
| `LINEAR_API_KEY` | Existing Linear MCP credential used by the worker for the linked Linear issue. |

Hetzner production receives and authenticates the webhook, so it loads
`INTEXURAOS_SENTRY_WEBHOOK_SECRET` and
`INTEXURAOS_SENTRY_AUTOMATION_USER_ID` through
`scripts/hetzner/load-secrets.sh`.

The home-dev orchestrator systemd environment sets
`INTEXURAOS_ERROR_HUB_HOST`. The worker image exposes only the `error_hub` MCP
for issue evidence. Its fixed bearer value is syntactic only; private network
reachability is the access boundary. Neither the orchestrator nor an isolated
worker requires or receives `INTEXURAOS_SENTRY_AUTH_TOKEN` or
`SENTRY_AUTH_TOKEN`.

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

1. SentryBox sends a signed `issue` or `event_alert` webhook to code-agent.
2. Code-agent verifies `Sentry-Hook-Signature`.
3. Code-agent parses the Sentry org, project, issue ID, issue URL, title,
   action, event ID when present, and received time.
4. Code-agent classifies the parsed delivery before reserving dedupe state.
   `issue.created`, `issue.regressed`, `issue.unresolved`, `issue.reopened`,
   and active `event_alert.triggered` deliveries are actionable. Lifecycle
   cleanup, assignment, terminal, unknown, and Sentry sample/test deliveries
   return `200` with an ignored message.
5. Code-agent persists an audit/dedupe record in `sentry-issue-events` only for
   actionable deliveries. Ignored deliveries do not reserve task dedupe state.
6. Duplicate deliveries for the same Sentry issue transition return success
   without creating another task. Later regressed or reopened transitions use a
   separate dedupe key so a resolved issue can create a new task when it becomes
   active again.
7. Code-agent creates or links the Linear issue for the Sentry issue.
8. Code-agent queues a CodeTask with `agentType: "sentry"` and the configured
   Sentry worker type.
9. The orchestrator dispatches the worker with Linear access and the private
   SentryBox hostname.
10. The worker uses only the `error_hub` MCP to fetch current issue details and
   recent events, attempts reproduction when feasible, and opens a PR.
11. Completion is rejected unless the worker reports a PR URL and the outcome is
    `fixed` or `suppressed`.

The task final result records the PR URL, Sentry issue URL, Linear issue ID,
outcome, and verification evidence.

## Verification

After changing the integration or its deployment config, run:

```bash
pnpm run ci:tracked
```

For a live smoke test:

1. Send a controlled SentryBox event to a low-risk project and environment.
2. Confirm the SentryBox delivery log shows a 2xx response.
3. Confirm test/sample deliveries return ignored and do not create a
   `sentry-issue-events` record.
4. Trigger an actionable delivery and confirm code-agent stores one
   `sentry-issue-events` record for the Sentry issue transition.
5. Confirm one Linear issue is created or linked.
6. Confirm one queued CodeTask exists with `agentType: "sentry"`.
7. Confirm the task worker type matches the automation user's
   `defaultSentryWorkerType`.
8. Run the pinned Error Hub MCP verifier against the created issue and event,
   and confirm the worker fetches both through `error_hub`.
9. Confirm successful completion includes a PR URL and a final outcome of
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
