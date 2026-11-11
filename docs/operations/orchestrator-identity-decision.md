# Home Dev Orchestrator Identity Decision

Status: Accepted

## Decision

The retained Home Dev orchestrator is a production-owned code-task worker. Its generated fallback
destinations are pinned to:

- `INTEXURAOS_CODE_AGENT_URL=https://intexuraos.cloud/api/code`
- `INTEXURAOS_USAGE_WEBHOOK_URL=https://intexuraos.cloud/api/code/internal/webhooks/usage-events`

A task-provided `webhookUrl` remains authoritative for its logs, lifecycle events, turn metrics,
compliance report, terminal status, and completion callback. A task-scoped callback consumer may
use the fixed Code Agent URL only when its contract explicitly permits a missing task callback;
non-task control-plane calls use the same fixed production base directly. A present but malformed
task callback fails closed. A valid callback without an internal path marker retains its owner
(the canonical `/api/code` base for an IntexuraOS public host, otherwise the callback origin)
instead of silently switching to the fixed fallback.

Persisted tasks are runtime-validated before recovery: their callback URL must be a non-empty
HTTP(S) URL and their callback secret must be non-empty. Adoption registers that owner before any
worktree-repair log is appended, and registration atomically rebinds any already-created
forwarding state. Missing, empty, malformed, or non-HTTP persisted owners fail closed rather than
using the optional static fallback.

## Legacy host tags

The generated values `INTEXURAOS_ENVIRONMENT=dev` and `INTEXURAOS_RUNTIME=dev` remain unchanged.
They identify the physical Home Dev host in Sentry and control observability defaults; they are
not callback-routing authority, credential selectors, data-plane selectors, or proof that a live
DEV application environment exists.

The complete reviewed data flow and value classes are tracked in
`config/environments/orchestrator-home-dev-identity-audit.json`. Changing either tag to `prod`
would reclassify Sentry data and tracing behavior without improving callback ownership, so that
change is rejected.

The audit derives both the declared transitive workspace dependency closure and the real esbuild
input closure rooted at `workers/orchestrator/src/index.ts`. The latter follows package `exports`,
static imports and re-exports, literal dynamic imports, CommonJS `require()` calls, and relative
edges even when they escape a conventional `src` directory. Its sorted input list is bound by an
exact count and canonical SHA-256. Unresolved inputs, bundled undeclared dependencies, paths
outside the repository, unsupported input types, and non-literal runtime module loads fail closed.
A `src/__tests__` file reached through a package export or production import is an
audited runtime input; an unreferenced test file is not.

Any new literal tag occurrence in the resulting bundle inputs is recorded 1:1 with its file,
line, column, AST node kind, and reviewed source SHA-256. Parse diagnostics, duplicate JSON object
keys, missing or duplicate occurrences, and stale review hashes fail the gate. Manual data-flow
consumers are bound to the reviewed source SHA-256 and one exact allowlisted non-routing sink
classification. Every literal `(environment variable, file)` pair must have a reviewed consumer;
a newly discovered literal cannot be accepted by updating the occurrence list alone. Each
consumer also binds its concrete AST sink or forwarding usage by line, column, node kind, usage
class, and span SHA-256. Callback ownership, routing authorities, credential authorities, and
fixed tag values are exact semantic contracts rather than free-form audit metadata.

`BootstrapEnvConfig` deliberately does not expose an `environment` field. The legacy host label is
read only inside `bootstrap/observability-identity.ts`, converted to the private branded
`ObservabilityEnvironment` type, and immediately forwarded to the exact
`@intexuraos/infra-sentry` `initWorker.environment` sink. `start.ts` is the sole production
importer of that closed bootstrap boundary; neither service wiring nor routing receives the value.
Audit schema v6 binds the reviewed hashes of the bootstrap config, boundary module, sole importer,
and service-wiring module. Its AST gate requires one exact unaliased import, one direct boundary
call, the private brand and reader, and the direct branded-value-to-Sentry assignment. Adding an
`env.environment` routing branch without adding the environment-variable literal therefore fails
closed instead of escaping the literal occurrence audit.

## Credentials and retained project

The generator continues to pin the external least-privilege
`home-orchestrator-sa-key.json`. The retained project name `intexuraos-dev-pbuchman` and the key
filename are legacy identifiers, not environment-routing signals. No secret value is stored in
this decision record or its audit report.

Two live, non-printing evidence gates remain intentionally pending outside repository work:

- `credential-principal-metadata`
- `prod-hmac-internal-auth-secret-match`

Neither pending gate permits a DEV callback fallback. If either fails, stop the cutover and restore
the preceding protected environment projection; rotate secrets only through a separately approved,
version-pinned package operation.

## Regression tests

The generator tests pin production callback and usage endpoints even when the
parent process supplies localhost or obsolete public DEV URLs. The strict worker
projection tests prevent unrelated secrets from reaching a code worker. Existing
production deployment tests execute the web environment renderer and check that
only relative API paths reach the build. Production Matrix uses
`matrix-outbound.intexuraos.cloud`; its routing tests belong to `pbuchman-dev`.

## Reversal

Reversal is a repository change that restores a previously reviewed generator and regenerates the
mode-`0600` environment atomically. It must not edit the generated file by hand. Task callback
ownership remains authoritative during both forward and reverse transitions.
