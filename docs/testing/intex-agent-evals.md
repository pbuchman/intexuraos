# Intex Agent Evaluation Runbook

## Scope and safety

The evaluator runs only on the Linux host `home-dev`, from
`$HOME/deploy/intexuraos`, through the SSH alias `home-dev`. Its fixed host-local
service ports are Intex Agent `8134`, WhatsApp Service `8113`, and Matrix adapter
`8099`.

Endpoint scenarios use the real deployed Intex Agent LLM, mocked product tools,
synthetic test users, and guarded cleanup. The endpoint accepts from 1 through
exactly 20 product turns. `or:minimax/minimax-m3` is the only semantic judge.
Missing credentials, a timeout, invalid output, or provider failure is an
infrastructure failure with exit `2`; there is no fallback judge.

`endpoint` and `scenario` send no real Matrix message. `matrix-smoke` sends one
safe operator-owned Matrix/WhatsApp prompt. `full` sends that one prompt only when
the endpoint corpus executed by the same invocation passes; otherwise it stops
before Matrix. A sent prompt can leave one real Intex Agent session plus bridge
metadata. The documented final acceptance runs `full`, not a preceding standalone
`matrix-smoke`, and therefore sends at most one safe message.

Preparation commands never run the wrapper. Every wrapper command below is
**LIVE** and requires the explicit instruction “odpal testy” or equally explicit
authorization. `preflight`, `endpoint`, `scenario`, `matrix-smoke`, and `full`
can invoke paid MiniMax calls.

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
Dev it requires that revision to be an ancestor of deployed `HEAD`, enters the
fixed repository, verifies `direnv` and `node`, preserves remote exits `0`, `1`,
and `2`, and forwards only safe CLI output.

The CLI report, not the wrapper, records preflight checks; scenario, turn, reply,
and tool totals; deterministic and MiniMax verdicts; cleanup counts; Matrix
transport facts; duration; aggregate token counts; and provider-reported USD. The
terminal and reports retain no prompts, replies, rationale, credentials, protected
paths, raw errors, or real identifiers.

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
```

The wrapper accepts only `setup`, `preflight`, `endpoint`, `full`,
`scenario intex-eval-NNN`, and `matrix-smoke` in those forms. `scenario` and
`matrix-smoke` are targeted diagnostics, not additional final-acceptance steps.

Normal operator acceptance is `preflight` → `endpoint` → `full`. If preflight
returns `CONFIG_NOT_FOUND`, obtain the operator's values through one interactive
`setup`, then rerun preflight. Stop on a nonzero endpoint result before sending a
real message. After endpoint exit `0`, run `full` once and do not also run
`matrix-smoke`. The fresh endpoint corpus inside `full` independently gates its
Matrix stage, so a behavioral or infrastructure result there also sends no
message.

## Exit codes and triage

| Exit | Meaning | Action |
| --- | --- | --- |
| `0` | All executed deterministic and MiniMax checks passed. | Preserve report path and continue. |
| `1` | Behavioral failure. | Preserve report, list failed scenario IDs, stop before `full`, correct through a new reviewed revision. |
| `2` | Configuration, revision, connectivity, endpoint, cleanup, judge, Matrix, or reporting infrastructure failure. | Preserve safe code/output, stop, correct the named boundary, rerun from preflight. |

Triage only from the safe terminal code and report fields. Never paste protected
configuration, raw provider or endpoint bodies, assistant text, Matrix history,
tokens, or protected paths.

`revision_mismatch` means the reviewed revision has not reached the existing Home
Dev deployment. Wait for deployment; do not use remote `git pull`, `rsync`, `scp`,
or a wrapper bypass. After the reviewed merge is an ancestor of deployed `HEAD`,
restart only the Home Dev `intex-agent` PM2 process and verify health on all three
fixed ports before preflight. A missing configuration requires the operator's
interactive values; never infer them from e-mail or adapter legacy fields.
