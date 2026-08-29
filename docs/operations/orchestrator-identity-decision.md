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

## Regression gate

`pnpm run verify:production-dev-dependencies` derives its source universe from every tracked and
non-ignored untracked repository file; the policy cannot remove a directory, file type, app,
package, workflow, document, or IaC input from that universe. Every intentional
`dev.intexuraos.cloud` occurrence requires an exact byte-preserving line, exact occurrence count,
classification, owner, and reason in
`config/environments/production-dev-dependency-allowlist.json`. Matching delegates literal host
canonicalization to Node's WHATWG/UTS-46 `domainToASCII` implementation after bounded lexical
decoding for JavaScript/JSON, YAML/HCL, shell ANSI-C, CSS, and HTML/XML entities. This covers case,
terminal DNS dots, percent-encoded bytes, compatible Unicode labels, source escapes, and supported
line continuations without maintaining a second handwritten IDNA table. The gate also resolves its
bounded set of common static JavaScript/TypeScript expressions and literal GitHub Actions `env`
references, including multiline expressions and conservative YAML anchor/alias handling. Workflow
analysis composes statically enumerable `env` values with literal `format(...)` calls and
shell-adjacent quote/ANSI-C projections. After all supported projections, any unresolved workflow
value that could complete the forbidden hostname fails closed; a standalone unresolved value with
no static hostname context does not. An exception always names the exact discovered source line:
for a computed or cross-line occurrence, that is the mapped sink line and need not itself contain
the complete hostname.

The reader rejects duplicate JSON keys, non-canonical paths, symlinks, malformed UTF-8, and NUL
bytes. It requires identical Git inventories before and after scanning and re-reads every file to
verify its SHA-256 after the canonical dependency check. Known image assets are
signature-validated; the sole intentional NUL-bearing regression fixture is separately pinned by
path and SHA-256. New, duplicate, stale, non-exact, case-variant, inventory-race, or
file-swap-hidden occurrences fail CI.

The gate's explicit trust boundary is repository input plus the documented bounded static folds:
literal/one-definition templates and concatenation, literal array joins, `String(...)`, supported
literal UTF-8 base64 decoding, and the documented compositional GitHub Actions workflow folds.
Unresolved workflow values in static forbidden-host context fail the gate; unrelated unresolved or
mutable identifiers, runtime branches, general shell substitution, reversal, and arbitrary custom
decoders require data-flow or execution evidence. Production web deployment therefore has an
additional executable sentinel test: the real `deploy-web.sh` must project only the manifest's
relative `apiPath` into both the build process environment and sanitized dotenv file, never its
retained `serviceUrl`.

The production Matrix adapter now uses the production-owned hostname
`matrix-outbound.intexuraos.cloud`. The former production-to-DEV runtime dependency and its
temporary M4.1 allowlist entry must both remain absent; the final tracked policy may not classify
any occurrence as `pending-milestone`.

## Reversal

Reversal is a repository change that restores a previously reviewed generator and regenerates the
mode-`0600` environment atomically. It must not edit the generated file by hand. Task callback
ownership remains authoritative during both forward and reverse transitions.
