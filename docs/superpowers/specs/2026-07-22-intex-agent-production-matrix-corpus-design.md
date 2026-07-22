# Intex Agent Production Matrix Corpus Design

**Date:** 2026-07-22

**Status:** Written review pending; production boundary approved by the user on 2026-07-22

**Supersedes for live acceptance:** the Home Dev runtime boundary in
[`2026-07-19-intex-agent-matrix-corpus-live-acceptance-design.md`](./2026-07-19-intex-agent-matrix-corpus-live-acceptance-design.md)

## Decision

The canonical 20-scenario Matrix/WhatsApp acceptance run tests only the production
IntexuraOS instance deployed on Hetzner.

Home Dev remains the trusted runner host because the protected Matrix account, access
token, room binding, and operator configuration already exist there. Home Dev does not
process a corpus webhook, create an Intex Agent session, call the agent model, execute a
tool mock, or own a Test Run. Those system-under-test responsibilities belong to the
production `whatsapp-service` and `intex-agent` processes on Hetzner.

The current failure is explained by this missing boundary. Meta delivered the numbered
test message to the canonical production webhook, while the production WhatsApp service
had Matrix corpus processing disabled. It persisted the signed event as ignored with
`MATRIX_CORPUS_CONTROL_PLANE_NOT_READY`; the Home Dev runner then waited for a scenario
binding that production could never create.

## Success contract

One explicitly authorized invocation of:

```bash
scripts/run-intex-agent-evals-prod.sh matrix-corpus
```

must:

1. run the tracked 20 scenarios and 59 turns in order;
2. send every input through the existing operator Matrix account and real
   Matrix-to-WhatsApp bridge;
3. deliver every resulting Meta webhook to
   `https://intexuraos.cloud/api/whatsapp/webhooks`;
4. process every test turn in the Hetzner production `whatsapp-service`;
5. create 20 distinct test sessions in the Hetzner production `intex-agent`;
6. use `or:deepseek/deepseek-v4-flash` for all 59 agent turns;
7. route all 19 scheduled tool executions through strict mocks and admit zero production
   product-tool executors;
8. process all 17 confirmation decisions through the ordinary confirmation UX while
   retaining the strict-mock session profile;
9. evaluate every correlated reply deterministically and with
   `or:minimax/minimax-m3`;
10. expose the same privacy-safe result to the authenticated owner at
    `https://intexuraos.cloud/#/intex-agent/sessions?view=test-runs`;
11. write the private report on Home Dev and exit `0` only if every required assertion
    passes.

The passing cardinalities are exact: 20 scenarios, 59 sent turns, 59 correlated terminal
turns, 59 expected replies, 17 confirmation decisions, 19 strict-mock executions, 20
unique session bindings, and zero production-tool executor admissions.

## Fixed runtime identities

The implementation must use distinct names for the machine controlling the run and the
environment under test:

| Concept | Canonical value | Meaning |
| --- | --- | --- |
| `runnerHost` | `home-dev` | Linux host that holds Matrix credentials and runs the evaluator CLI |
| `environmentAlias` | `prod` | Public IntexuraOS environment under test |
| `runtimeAudience` | `hetzner-prod` | Closed audience embedded in capabilities, attestations, contexts, leases, projections, and reports |
| `trustedRuntime` | `hetzner-prod` | Production service startup gate |
| public origin | `https://intexuraos.cloud` | Health, deployment attestation, authenticated Test Runs, and Google-OIDC control entrypoint |
| time zone | `Europe/Warsaw` | Fixed corpus clock boundary |

`home-dev` remains valid only as a runner-host value and as a legacy persisted audience
that production must never execute. New capabilities, records, and reports use
`hetzner-prod`. Code must not overload the runtime audience to describe where the CLI is
running.

## End-to-end flow

1. The workstation wrapper verifies a clean reviewed revision and connects to Home Dev.
2. The Home Dev runner verifies its checkout, the production deployment attestation,
   the production health endpoints, its protected Matrix configuration, the exact
   product-user binding, provider availability, Firestore indexes, and production corpus
   readiness without sending a message or creating a run.
3. For control-plane operations, the runner obtains a short-lived Google identity token
   for audience `https://intexuraos.cloud` using the existing Home Dev development
   service-account credentials.
4. The Hetzner Nginx edge accepts that identity only on two new corpus-specific route
   prefixes. It removes caller-supplied internal headers, injects the production internal
   auth token, and rewrites the request to the existing private Matrix corpus routes in
   `whatsapp-service` or `intex-agent`.
5. Production `whatsapp-service` provisions and activates the fenced run, then issues a
   one-use capability for the next catalog turn.
6. Home Dev sends the capability-bearing, visibly numbered message through Matrix.
7. The existing bridge mirrors that user-authored event to WhatsApp. The operator sees
   it on the phone.
8. Meta calls the canonical Hetzner production webhook. Production `whatsapp-service`
   validates the Meta signature, maps the sender to the configured product user,
   consumes the capability atomically, removes the test header, and publishes the
   attested natural message.
9. Production `intex-agent` validates the attestation, creates or continues the isolated
   test session, calls DeepSeek V4 Flash, and uses only the immutable strict-mock
   executor selected by the accepted session profile.
10. The normal production outbound flow sends the assistant reply to WhatsApp.
    Production `whatsapp-service` also uses its existing protected Matrix outbound
    adapter to mirror the reply into the same Matrix room on Home Dev.
11. The Home Dev runner correlates Matrix delivery, production ingress, session,
    terminal, reply, usage, confirmation, and strict-mock evidence before advancing.
12. MiniMax M3 evaluates the correlated reply. The runner updates the production Test
    Run projection through the protected control plane.

Matrix remains the visible transport. It is not the system under test and it does not
host an Intex Agent runtime.

## Production control-plane ingress

### Edge routes

The existing `/api/<service>/internal` paths remain blocked, and a caller-supplied
`X-Internal-Auth` header remains unusable from the Internet. Add only these protected
prefixes:

```text
/internal/evals/whatsapp/*
/internal/evals/intex-agent/*
```

Nginx must:

- require a Google OIDC bearer token with audience `https://intexuraos.cloud`;
- allow only the existing `claude-code-dev` service account used on Home Dev;
- assign the closed caller role `matrix_corpus_runner`;
- accept only paths below `matrix-corpus` for these prefixes;
- rewrite the WhatsApp prefix to the existing WhatsApp service
  `/internal/matrix-corpus/*` routes;
- rewrite the Intex Agent prefix to the existing Intex Agent
  `/internal/matrix-corpus/*` routes;
- clear `Authorization`, cookies, `From`, and caller-provided internal headers before
  proxying;
- inject the production internal-auth token exactly as other protected internal routes
  do;
- keep request bodies, identifiers, capabilities, and response payloads out of access
  and application logs.

Requests outside those exact prefixes continue to use the current deny/default routing.
The edge contract receives unit tests proving missing, malformed, wrong-audience, and
wrong-service-account tokens are rejected and that path traversal or a non-corpus path
cannot reach a service.

### Runner HTTP client

The evaluator receives a production control client with:

- fixed origin `https://intexuraos.cloud`;
- the service-specific route prefix;
- a cached, automatically refreshed Google identity token;
- bounded timeouts;
- response-size limits and closed schema validation;
- no fallback to the Home Dev loopback ports;
- no fallback to public `/api/*/internal` routes;
- no retry of a mutating request unless the existing operation has an explicit
  idempotency key and the retry is the existing idempotent reconciliation path.

The evaluator package declares `google-auth-library` directly rather than relying on a
transitive dependency. Identity tokens and internal tokens never appear in logs,
reports, command output, or persisted artifacts.

## Production service enablement

`whatsapp-service`, `intex-agent`, and the owner-gated Test Runs configuration must accept
the closed production pair:

```text
INTEXURAOS_ENVIRONMENT=prod
INTEXURAOS_MATRIX_CORPUS_TRUSTED_RUNTIME=hetzner-prod
INTEXURAOS_MATRIX_CORPUS_RUNTIME_AUDIENCE=hetzner-prod
```

They must continue to reject every other enabled combination. The existing disabled
state remains supported for emergency rollback.

Literal `home-dev` audience constraints in domain types, schemas, route headers,
attestations, encrypted context bindings, repositories, Test Runs, safe reports,
retention, and clients are replaced by one shared closed Matrix-corpus audience contract.
The allowed values are only `home-dev` for reading/cleaning legacy records and
`hetzner-prod` for the new runtime. Production creation and execution accept only
`hetzner-prod`; they never upgrade or execute a legacy `home-dev` record.

The production PM2 configuration must:

- enable Matrix corpus only for `whatsapp-service` and `intex-agent`;
- enable Test Runs read only for the configured evaluator user;
- expose the Intex Agent model selector only to that same configured user;
- supply only the corpus secrets needed by each service;
- keep the fixed enable, trusted-runtime, and audience values in tracked configuration;
- fail service startup when any required secret is missing or malformed.

The existing model-selector UX and API contract remain unchanged. DeepSeek V4 Flash is
the default and mandatory corpus agent model; MiniMax M3 and Gemini 3 Flash Preview remain
the other two user-selectable Intex Agent models. The corpus rejects an effective model
other than DeepSeek regardless of an ordinary user preference.

## Secret provisioning

The repository stores only secret names and validation rules. It never stores the
operator email, Auth0/Firebase UID, phone number, WhatsApp account/sender identifiers,
Matrix user/room identifiers, access token, HMAC key, private/public signing material,
or context encryption key.

The following existing Home Dev values are provisioned as production Secret Manager
versions without printing or writing their values to a repository artifact:

- `INTEXURAOS_MATRIX_CORPUS_EVALUATOR_USER_ID`
- `INTEXURAOS_MATRIX_CORPUS_MATRIX_ROOM_BINDING`
- `INTEXURAOS_MATRIX_CORPUS_WHATSAPP_ACCOUNT_BINDING`
- `INTEXURAOS_MATRIX_CORPUS_WHATSAPP_SENDER_BINDING`
- `INTEXURAOS_MATRIX_CORPUS_BINDING_HMAC_KEY`
- `INTEXURAOS_MATRIX_CORPUS_SIGNING_KEY_VERSION`
- `INTEXURAOS_MATRIX_CORPUS_SIGNING_PRIVATE_KEY`
- `INTEXURAOS_MATRIX_CORPUS_SIGNING_PUBLIC_KEY`
- `INTEXURAOS_MATRIX_CORPUS_CONTEXT_ENCRYPTION_KEY_VERSION`
- `INTEXURAOS_MATRIX_CORPUS_CONTEXT_ENCRYPTION_KEY`

Terraform declares these secret containers and grants the Hetzner provisioner access to
load them. Runtime access remains no broader than required by the established Hetzner
secret-loading model. `scripts/hetzner/load-secrets.sh` loads the names into the protected
mode-`0600` production environment file, while PM2 passes per-service subsets.

Provisioning order is fail-closed:

1. validate that every source value exists and has the expected shape without printing
   it;
2. create the Secret Manager containers through reviewed Terraform;
3. stream each value directly from the protected Home Dev environment into a new secret
   version;
4. validate latest-version availability and format without rendering the value;
5. only then merge/deploy service enablement.

If the Terraform plan contains unrelated mutation or a required source value is absent,
deployment stops before production enablement and reports the exact operator
intervention required.

The Matrix access token and Matrix targets file remain only on Home Dev. They are not
moved to Secret Manager or Hetzner.

## Strict-mock safety invariants

Moving the runtime to production must not weaken the existing safety model:

1. A prompt, visible label, scenario number, or copied capability prefix never enables
   test mode.
2. Only a valid, unexpired, one-use capability bound to the exact user, bindings, run,
   scenario, turn, prompt digest, lease, and production audience can create a test
   ingest.
3. Consumption happens after canonical user mapping and before ordinary message
   persistence or publication.
4. Malformed, expired, replayed, wrong-user, wrong-audience, or otherwise invalid
   corpus-shaped traffic is terminally rejected and never falls back to ordinary
   processing.
5. The immutable accepted session profile selects the strict mock executor for initial,
   continuation, and confirmation execution.
6. Missing or undecodable context fails closed; it never creates a normal production
   session.
7. Every terminal turn persists an execution-boundary event proving either a strict mock
   execution or the closed `no_executor_required` outcome.
8. Any observed production-tool executor admission, real tool call, missing boundary
   event, or evidence mismatch immediately quiesces the run and makes the run fail.
9. The evaluator never invokes product tool APIs directly to prove a mock.
10. Cleanup uses exact run/session identifiers and never performs a user-wide delete.

Unit and composition tests must include a production-enabled configuration and prove
zero calls to each real executor for all 11 product tools, including confirmation
continuation.

## Preflight and revision attestation

The embedded preflight remains read-only and runs before a lease, capability, message,
LLM call, artifact directory, or Firestore write. It must prove:

- the workstation and Home Dev runner guarded paths are clean;
- the reviewed requested SHA is a 40-character commit deployed both to the Home Dev
  runner checkout and to Hetzner production;
- `https://intexuraos.cloud/deployment.json` reports exactly that SHA;
- public production health for WhatsApp Service and Intex Agent passes;
- both production OIDC corpus gateways authenticate and return ready schemas;
- the runtime reports `environmentAlias=prod` and `runtimeAudience=hetzner-prod`;
- the protected Home Dev Matrix configuration and token files retain their required
  ownership and modes;
- the configured product user exists and is enabled;
- the Matrix account, room, WhatsApp puppet, production WhatsApp account/sender, and
  configured evaluator UID form exactly one accepted tuple;
- the effective corpus agent is DeepSeek V4 Flash and MiniMax M3 is available as judge;
- all required Firestore indexes are `READY`;
- no conflicting active production corpus lease exists;
- production strict-mock capability readiness reports all 11 tools;
- the artifact root and capacity on Home Dev are ready;
- clock skew is within the existing bound.

A preflight failure exits `2` with zero sent messages and one closed failure code. The
runner must not silently call a Home Dev service after a production check fails.

## Command and operator UX

`scripts/run-intex-agent-evals-prod.sh matrix-corpus` becomes the only canonical live
acceptance command. The repository alias `pnpm eval:intex-agent:matrix-corpus` points to
it. The legacy command
`scripts/run-intex-agent-evals-home-dev.sh matrix-corpus` fails before any send with
`PRODUCTION_MATRIX_CORPUS_REQUIRED`; it cannot accidentally recreate the split-runtime
failure.

The numbered visible message format remains unchanged. The operator sees 59 user test
messages and 59 assistant replies in the existing WhatsApp conversation. The first turn
of every scenario begins with `new session:` and `Scenario NNN/020`; the server removes
the corpus metadata before the LLM sees or persists the natural request. The agent does
not interpret or ask about the scenario label.

Implementation progress notifications requested by the operator are distinct from
corpus traffic. They must not use the reserved corpus prefix, must not issue a capability,
and must not be counted in a Test Run. The implementation plan defines 15 milestones;
after each completed milestone the operator receives the short status
`Krok N/15 wykonany — …; kolejny: …` through the established Matrix/WhatsApp-visible
channel. A failed milestone reports the blocking intervention instead of claiming
completion.

The authenticated Test Runs UI continues to show only the configured owner’s runs. It
shows the production environment, DeepSeek agent model, MiniMax evaluator, exact scenario
and turn progress, deterministic/MiniMax verdicts, safe tool evidence, usage, cost, and
closed failure codes without exposing capabilities, raw tool arguments, provider
reasoning, account identifiers, or credentials.

## Failure and retry semantics

One command invocation creates at most one run and sends each catalog turn at most once.
Transport ambiguity never triggers a blind resend. The existing idempotency keys,
send-proof records, capability consumption, outbox records, and reconciliation queries
decide whether to continue or stop.

The requested end-to-end loop means:

1. run one admitted corpus invocation;
2. if it fails, preserve the safe report and diagnose the exact boundary;
3. correct the code/configuration through a reviewed revision;
4. deploy and attest that revision;
5. start a new explicitly identifiable run.

It does not mean retrying an ambiguous message inside the same run or bypassing an
admission failure.

Exit codes remain:

| Exit | Meaning |
| --- | --- |
| `0` | All 20 scenarios passed deterministic, MiniMax, transport, session, and strict-mock checks. |
| `1` | The infrastructure completed, but one or more agent behavior checks failed. |
| `2` | Revision, configuration, identity, transport, provider, evidence, cleanup, or reporting infrastructure failed. |

## Verification strategy

Implementation follows test-driven development. Targeted tests are run while editing;
the full `pnpm run ci:tracked` gate is run once when the integrated change is ready to
commit, and repeated only if that integrated gate exposes a change requiring another
full verification.

Required automated coverage includes:

- production and disabled config parsing for all three services;
- closed shared runtime-audience schemas and legacy-record non-execution;
- OIDC token acquisition/refresh without token logging;
- service-specific control-prefix construction;
- Nginx identity/path allowlist and rewrite behavior;
- production PM2 secret scoping and removal of the old forced-disable assertions;
- Hetzner secret inventory and Terraform declarations;
- no secret or account-specific value in tracked files or reports;
- production deployment-attestation mismatch and health/readiness failures;
- zero-side-effect preflight;
- all existing capability, replay, outbox, confirmation, strict-mock, retention, and
  Test Runs tests under `hetzner-prod`;
- wrapper rejection of the legacy Home Dev corpus path;
- report schema/cardinality validation for 20 scenarios and 59 turns.

Before merge, independent review covers correctness/security, test completeness, and
operator/Test Runs UX. After merge, verification proceeds in this order:

1. wait for the GitHub Hetzner deployment job to pass;
2. require public `deployment.json` to equal the merged SHA;
3. verify production public health and protected corpus readiness;
4. update the clean Home Dev runner checkout to the same SHA without restarting Home Dev
   product services;
5. run exactly one 20-scenario production corpus;
6. verify the safe report cardinalities and verdicts;
7. sign in to the existing production owner account in the browser and confirm the same
   Test Run, scenario timeline, model labels, and tool-mock evidence;
8. report PASS/FAIL with the run ID, safe report path, failed scenario IDs, and any exact
   intervention required.

## Deployment and rollback

The pull request contains code, tests, Nginx configuration, Terraform secret inventory,
Hetzner secret loading, PM2 wiring, wrapper changes, and updated runbooks. It contains no
secret values.

The merge to `development` triggers the existing Hetzner production deployment. The
deployment must load secrets before restarting PM2, deploy Nginx, verify backend/public
health, and publish the deployment attestation only after readiness succeeds.

Rollback is configuration-first and message-safe:

1. set production Matrix corpus and Test Runs flags to disabled through a reviewed
   rollback revision;
2. deploy/restart WhatsApp Service, Intex Agent, and User Service;
3. confirm readiness reports disabled and no new corpus capability can be issued;
4. keep old Test Run projections and secrets for forensic review; do not delete user data
   or broad Firestore collections;
5. leave ordinary WhatsApp/Intex Agent processing unchanged.

If a run is active during rollback, quiesce and release it through the exact fenced run
control before disabling when possible. If not possible, expiry and recovery remain
fail-closed and no ordinary executor may consume its context.

## Non-goals and deferred hardening

- The first production delivery does not create a dedicated WhatsApp number or a new
  product user. It uses the already configured existing operator account.
- The Matrix token remains Home-Dev-specific; cross-machine portability is deferred.
- The corpus is manually invoked after explicit authorization; scheduling is deferred.
- A dedicated least-privilege evaluator service account may replace the existing
  Home Dev development service account later. The first delivery still restricts that
  identity to the two corpus-only edge prefixes.
- The first delivery keeps the existing single-host PM2 trust boundary: Nginx enforces
  the external OIDC service-account allowlist, while localhost services share the
  internal-auth boundary. Per-service Unix identities and a distinct corpus-control
  credential are deferred hardening.
- PM2 limits which secrets are inherited by each process, but the shared deploy account
  can still read the root production environment file. Per-service credential files or
  a runtime credential broker are deferred together with per-service Unix identities.
- Existing transport capabilities remain visible in the operator’s Matrix/WhatsApp
  message as designed; hidden bridge metadata is deferred.
- The endpoint diagnostic lane remains available but is not live acceptance and is not
  automatically run before the production corpus.

These items stay documented in the repository and do not block the approved production
value.

## Acceptance checklist

The goal is complete only when all boxes can be supported by fresh evidence:

- [ ] reviewed implementation merged to `development` through a pull request;
- [ ] required Secret Manager containers and versions exist without tracked values;
- [ ] GitHub Hetzner deployment succeeds for the merge SHA;
- [ ] production deployment attestation equals that SHA;
- [ ] legacy Home Dev corpus command cannot send;
- [ ] production preflight passes with zero messages;
- [ ] one full run executes 20 scenarios and 59 turns;
- [ ] WhatsApp visibly contains all numbered flows and assistant replies;
- [ ] report proves 20 distinct sessions, 17 confirmations, and 19 strict-mock calls;
- [ ] report proves zero production-tool executor admissions;
- [ ] every reply has deterministic and MiniMax M3 evaluation;
- [ ] production Test Runs shows the same owner-gated run in the browser;
- [ ] final operator report states PASS/FAIL and any required intervention unambiguously.
