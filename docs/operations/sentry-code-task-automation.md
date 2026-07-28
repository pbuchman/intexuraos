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

Hetzner production receives and authenticates the webhook, so it loads
`INTEXURAOS_SENTRY_WEBHOOK_SECRET` and
`INTEXURAOS_SENTRY_AUTOMATION_USER_ID` through
`scripts/hetzner/load-secrets.sh`. It deliberately does **not** load
`INTEXURAOS_SENTRY_AUTH_TOKEN` into the PM2 backend runtime.

The Sentry API token belongs to the `home-dev` orchestrator. The systemd unit
reads `INTEXURAOS_SENTRY_AUTH_TOKEN` from `~/.code-orchestrator/env` and injects
it into isolated workers as `SENTRY_AUTH_TOKEN`. Both currently deployed token
forms are valid when the Sentry API probe returns HTTP 200; this procedure does
not rotate or rewrite a working token.

### Safe home-dev token sync and verification

Run these steps on `home-dev` as the orchestrator account. Do not paste the
token into shell history, command arguments, logs, chat, or this runbook.

1. Edit `~/.code-orchestrator/env` with a trusted interactive editor, ensuring
   it contains exactly one `INTEXURAOS_SENTRY_AUTH_TOKEN=...` assignment.
2. Restrict the file and print only presence—not the value:

   ```bash
   chmod 600 ~/.code-orchestrator/env
   awk -F= '$1 == "INTEXURAOS_SENTRY_AUTH_TOKEN" && length($2) > 0 { found=1 }
     END { print found ? "SENTRY_AUTH_TOKEN: SET" : "SENTRY_AUTH_TOKEN: MISSING"; exit !found }' \
     ~/.code-orchestrator/env
   ```

3. Restart and verify the actual systemd owner (the orchestrator is not a PM2
   process):

   ```bash
   sudo systemctl restart intexuraos-orchestrator@pbuchman
   sudo systemctl status intexuraos-orchestrator@pbuchman --no-pager
   curl --fail --silent --show-error http://127.0.0.1:8199/health >/dev/null
   ```

4. In a private shell, load the env file, call the Sentry API, and print only
   the HTTP status. A valid token returns 200. Immediately unset both names:

   ```bash
   set -a
   source ~/.code-orchestrator/env
   set +a
   sentry_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
     --header "Authorization: Bearer ${INTEXURAOS_SENTRY_AUTH_TOKEN}" \
     https://sentry.io/api/0/)"
   unset INTEXURAOS_SENTRY_AUTH_TOKEN SENTRY_AUTH_TOKEN
   test "${sentry_status}" = 200
   printf 'Sentry API status: %s\n' "${sentry_status}"
   unset sentry_status
   ```

Do not use `systemctl show ... Environment` for this verification because it
can expose environment values. Do not copy the auth token into Hetzner's
`.env.prod` or restart unrelated runtime services.

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
9. The orchestrator dispatches the worker with Linear and Sentry access.
10. The worker fetches current Sentry issue details and recent events, attempts
   reproduction when feasible, and opens a PR.
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

1. Use Sentry's test delivery or trigger an issue alert for a low-risk project.
2. Confirm the Sentry integration delivery log shows a 2xx response.
3. Confirm Sentry test/sample deliveries return ignored and do not create a
   `sentry-issue-events` record.
4. Trigger an actionable delivery and confirm code-agent stores one
   `sentry-issue-events` record for the Sentry issue transition.
5. Confirm one Linear issue is created or linked.
6. Confirm one queued CodeTask exists with `agentType: "sentry"`.
7. Confirm the task worker type matches the automation user's
   `defaultSentryWorkerType`.
8. Confirm the worker can fetch Sentry details using `SENTRY_AUTH_TOKEN`.
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
