# Intex Agent Evaluation Runbook

## Scope and safety

The evaluator runs only on the Linux host `home-dev`, from
`$HOME/deploy/intexuraos`, through the SSH alias `home-dev`. Its fixed host-local
service ports are Intex Agent `8134`, WhatsApp Service `8113`, and Matrix adapter
`8099`.

`matrix-corpus` is the canonical live acceptance command. It runs the tracked corpus of
20 scenarios and 59 turns sequentially through the real Matrix/WhatsApp transport. Each
scenario starts a labelled Intex session and all later turns stay bound to that exact
session. The agent model is locked to `or:deepseek/deepseek-v4-flash`; product tools run
only through the strict mock boundary, while `or:minimax/minimax-m3` evaluates assistant
replies. Missing credentials, a timeout, invalid output, owner-cleanup failure, or provider
failure is an infrastructure failure with exit `2`; there is no fallback model, judge,
transport, or production tool execution.

The preflight embedded in `matrix-corpus` is read-only: it sends no message, calls no LLM,
creates no run or artifact, and performs no Firestore, Pub/Sub, or filesystem write. Only
after preflight passes may the command provision the run and send the first Matrix message.

`endpoint`, `scenario`, `matrix-smoke`, and `full` remain diagnostics for the legacy
evaluator path. They are not substitutes for the 20-scenario Matrix corpus and are not
part of its normal acceptance sequence.

Preparation commands never run the wrapper. Every wrapper command below is
**LIVE** and requires the explicit instruction “odpal testy” or equally explicit
authorization. `endpoint`, `scenario`, `matrix-smoke`, `full`, and the execution phase of
`matrix-corpus` can invoke paid LLM calls. `preflight` does not.

## Protected machine-local configuration

The configuration exists only on Home Dev at
`~/.config/intexuraos/intex-agent-evals.json`. Its parent directory must be a
current-UID-owned, non-symlink directory with exact mode `0700`. The configuration
must be a current-UID-owned, non-symlink regular file with exact mode `0600`.
Its strict structure is:

```json
{
  "schemaVersion": 1,
  "accountAlias": "operator-test",
  "userId": "canonical-firebase-uid",
  "matrixUserId": "@matrix-user:homeserver.example",
  "matrixAccessTokenFile": "/absolute/protected/matrix-token",
  "matrixTargetsFile": "/absolute/protected/matrix-targets.json"
}
```

Both referenced paths must be absolute. The token and targets must each be a
current-UID-owned, non-symlink regular file with exact mode `0600`. The token file
contains one non-empty Matrix access token. The targets file has this strict
shape:

```json
{
  "matrix-source-account-id": {
    "intex_agent": "!room-id:homeserver.example"
  }
}
```

The top-level key must match Matrix adapter health `sourceAccountId`;
setup/preflight select only its `intex_agent` room. Never add a real UID, e-mail,
phone number, Matrix identity, room, token, protected absolute operator path, or
account data to Git.

`setup` is interactive and reads all five values without echo. Only the validated
`accountAlias` can appear afterward in the closed setup result. Run it only when
preflight returns `CONFIG_NOT_FOUND` or the operator has independently confirmed
that the configuration file is absent.

## Tracked inputs and private outputs

Tracked scenarios live at
`tools/intex-agent-evals/scenarios/*.scenario.json`. Evaluation reports remain on
Home Dev below
`$HOME/deploy/intexuraos/.artifacts/intex-agent-evals/<eval-run-id>/`. Each
evaluation command atomically publishes mode-`0600` `report.json` and `report.md`
inside a mode-`0700` run directory. `setup` and `preflight` write no report.

The wrapper prints only the safe relative path
`.artifacts/intex-agent-evals/<eval-run-id>`. The ignored reports stay on Home Dev;
the wrapper does not copy them to the workstation.

Before connecting, the wrapper requires clean evaluator implementation paths and
passes the workstation's exact 40-character `HEAD` only as revision proof. On Home
Dev it requires that revision to equal deployed `HEAD`, enters the
fixed repository, verifies `direnv` and `node`, preserves remote exits `0`, `1`,
and `2`, and forwards only safe CLI output.

The CLI report, not the wrapper, records preflight checks; scenario, turn, reply,
and tool totals; deterministic and MiniMax verdicts; cleanup counts; Matrix
transport facts; duration; aggregate token counts; and provider-reported USD. The
terminal and reports retain no prompts, replies, rationale, credentials, protected
paths, raw errors, or real identifiers.

For a passing canonical run, report validation requires 20 unique session-reference
digests, 59 correlated turns/replies, the tracked 17 confirmation decisions, the exact
19-row strict-mock tool schedule, reconciled DeepSeek/MiniMax usage, and successful ready
artifact cleanup/release gates. `sessionsClosed` remains `0` because session-close state is
not part of the current safe evidence projection; it must not be inferred from scenario
lifecycle. The strict-mock proof is derived from one persisted execution-boundary event per
terminal turn, including the explicit `no_executor_required` outcome for a rejected
confirmation, rather than from a report-side declaration.

## Exact commands

The following preparation commands are offline and safe during Phase 1:

```bash
pnpm --filter @intexuraos/intex-agent-evals validate
pnpm --filter @intexuraos/intex-agent-evals test
pnpm exec vitest run apps/intex-agent/src/__tests__/routes/testConversationRoutes.test.ts
pnpm run ci:tracked
```

**LIVE — requires “odpal testy”**

```bash
scripts/run-intex-agent-evals-home-dev.sh setup
scripts/run-intex-agent-evals-home-dev.sh preflight
scripts/run-intex-agent-evals-home-dev.sh endpoint
scripts/run-intex-agent-evals-home-dev.sh scenario intex-eval-003
scripts/run-intex-agent-evals-home-dev.sh matrix-smoke
scripts/run-intex-agent-evals-home-dev.sh full
scripts/run-intex-agent-evals-home-dev.sh matrix-corpus
```

The repository alias for the same canonical live operation is:

```bash
pnpm eval:intex-agent:matrix-corpus
```

The wrapper accepts only `setup`, `preflight`, `endpoint`, `full`,
`scenario intex-eval-NNN`, `matrix-smoke`, and `matrix-corpus` in those forms.
`scenario`, `endpoint`, `matrix-smoke`, and `full` are targeted legacy diagnostics, not
additional matrix-corpus acceptance steps.

The instruction **“odpal testy” means exactly one invocation of `matrix-corpus`**. Do not
prepend a separate `preflight`, `endpoint`, `full`, or `matrix-smoke`; the canonical
command contains its own zero-side-effect preflight. If it returns `CONFIG_NOT_FOUND`,
run one explicitly authorized interactive `setup`, then wait for another explicit live
test instruction. The wrapper performs no pull, deploy, restart, or revision switch.

## Deliberately deferred hardening

The current delivery is intentionally Home-Dev-specific. A portable account bootstrap,
automatic registration of dedicated e-mail/WhatsApp test identities, cross-machine
configuration distribution, and production scheduling remain future hardening; private
operator identities stay only in the protected local configuration.

Live evidence proves that every scenario has a distinct bound session and that its later
turns continue that binding. It does not yet expose every internal session-transition and
timeline field through the privacy-safe evidence DTO; those fields remain `not_observed`
rather than being inferred from expectations. Extending that DTO is the remaining path to
full internal-transition attestation.

Steady-state retention removes at most one old exact run per new provisioning lease. A
pre-existing backlog requiring more than one owner cleanup fails closed before mutation
and requires an explicit recovery operation; the runner never falls back to a user-wide
delete.

## Exit codes and triage

| Exit | Meaning | Action |
| --- | --- | --- |
| `0` | All executed deterministic and MiniMax checks passed. | Preserve report path and continue. |
| `1` | Behavioral failure. | Preserve the report, list failed scenario IDs, and correct through a new reviewed revision. |
| `2` | Configuration, revision, connectivity, cleanup, judge, Matrix, or reporting infrastructure failure. | Preserve safe code/output, stop, and correct the named boundary before another explicitly authorized run. |

Triage only from the safe terminal code and report fields. Never paste protected
configuration, raw provider or endpoint bodies, assistant text, Matrix history,
tokens, or protected paths.

`revision_mismatch` means the reviewed revision has not reached the existing Home
Dev deployment. Wait for deployment; do not use remote `git pull`, `rsync`, `scp`,
or a wrapper bypass. After the reviewed merge equals deployed `HEAD`,
restart only the Home Dev processes affected by that revision and verify health on all
three fixed ports before the next run. A missing configuration requires the operator's
interactive values; never infer them from e-mail or adapter legacy fields.
