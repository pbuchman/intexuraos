# INT-1624 - INT-1472 Progress Audit Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Audit INT-1472 and its 55 direct child security findings against Linear state, linked
plans, merged PRs, commit history, and current repository evidence.

**Architecture:** Evidence-first planning artifact. Linear status is treated as advisory; current
code and merged commits are the deciding evidence for whether a finding is implemented.

**Tech Stack:** Linear, GitHub PR history, local commit history, Terraform, Fastify services,
React web app, Docker worker isolation.

---

## Executive Summary

Generated: 2026-05-10 UTC.

INT-1472 itself was implemented as a security-audit deliverable: PR #1948 added
`docs/security/2026-04-24-security-audit.md` and filed 55 Linear child findings, and PR #1965
added the follow-up investigation for failed/canceled subtasks.

Current child-finding progress:

| Bucket | Count | Issues |
| --- | ---: | --- |
| Fully implemented in current code | 5 | INT-1483, INT-1486, INT-1520, INT-1524, INT-1525 |
| Partially mitigated but not fully closed | 6 | INT-1477, INT-1490, INT-1494, INT-1507, INT-1508, INT-1512 |
| Canceled/rejected in Linear | 18 | INT-1480, INT-1503, INT-1504, INT-1506, INT-1507, INT-1510, INT-1511, INT-1512, INT-1513, INT-1515, INT-1516, INT-1518, INT-1521, INT-1522, INT-1523, INT-1526, INT-1527, INT-1528 |
| Not fully implemented | 50 | All child issues except the 5 fully implemented findings |

Important interpretation:

- "Canceled" is a Linear disposition, not evidence that the finding was technically rejected.
- INT-1560 found the canceled findings were closed in a tight cluster with empty comments, consistent
  with manual load-shedding rather than security acceptance.
- The current codebase still contains direct evidence for many high-severity findings, including
  dangerous worker flags, shared internal auth, public Cloud Run invokers, unsigned OAuth state,
  permissive CORS, missing Firestore rules, and mutable `:latest` deployment images.

## Evidence Sources

- Linear parent: INT-1472, "Identify and document security vulnerabilities in IntexuraOS".
- Linear planning issue: INT-1624, "Evaluate implementation progress of INT-1472 and child issues".
- Linked PRs:
  - #1948, `[INT-1472] Security audit evidence - 55 findings filed to Linear`, merged.
  - #1965, `[INT-1560] [plan] Investigate failed subtasks of INT-1472 / INT-1473`, merged.
  - #1961, #1963, #1964, planning PRs for selected children.
  - #1970, #1972, #1976, #1985, #2001, implementation PRs for selected children.
- Current code searches for the specific files, flags, Terraform resources, route handlers,
  auth helpers, and browser components mentioned by the child issues.

## Fully Implemented Findings

These are implemented by merged PRs and still show current-tree evidence of the fix.

| Issue | Current Linear state | Evidence | Current code proof |
| --- | --- | --- | --- |
| INT-1483 - Shell injection in worker dispatch | QA | PR #2001 merged | `CreateTaskRequestSchema.taskId` now requires a canonical UUID; shell-sensitive flows use `execFile`/argv form; tests cover shell metacharacters. |
| INT-1486 - `E2E_MODE=true` bypass usable in production | QA | PR #1970 merged | `apps/code-agent/src/infra/auth/jwtValidator.ts` fails closed when production and `E2E_MODE=true`; tests cover production and non-production behavior. |
| INT-1520 - Guest chat rate-limit bypass | QA | PR #1985 merged | Chat guest sessions are signed by `guestSessionSigner`; `/guest-session` issues tokens; chat routes verify the token and key limits by verified guest subject. |
| INT-1524 - `/repo/node_modules` exec supply-chain risk | QA | PR #1976 merged | Docker/worker config forces `npm --ignore-scripts`, snapshots/audits the lockfile, and sets `NPM_CONFIG_IGNORE_SCRIPTS`; the exec mount remains because pnpm requires it. |
| INT-1525 - OAuth state logged at info | QA | PR #1972 merged | OAuth initiation logs a short `stateHash` instead of the raw OAuth state for Google and GitHub flows; tests assert raw state is absent from logs. |

## Partially Implemented Findings

These have meaningful mitigation in current code, but the original finding is not fully closed.

| Issue | Current Linear state | What is implemented | What remains |
| --- | --- | --- | --- |
| INT-1477 - Scheduler auth accepts any Bearer token | Todo | `apps/code-agent` has Google OIDC verification via `createGoogleOidcVerifier`. | `packages/common-http/src/auth/internalAuthStrategies.ts` and `apps/linear-agent/src/routes/internalRoutes.ts` still treat generic Bearer tokens as scheduler OIDC. |
| INT-1490 - No rate limiting anywhere | Todo | Chat guest traffic now has signed-session rate limiting from INT-1520. | No broad API, webhook, OAuth, or LLM endpoint rate-limit policy is visible. |
| INT-1494 - Timing leaks in comparisons | Todo | `packages/common-worker/src/auth.ts` uses `timingSafeEqual` and rejects `Bearer <token>` for worker auth. | `packages/common-http/src/auth/internalAuth.ts`, WhatsApp verify-token handling, and some signature helpers still have direct comparisons or early-return length checks. |
| INT-1507 - Missing body limits/timeouts | Canceled | Some schemas now have max lengths/items; `apps/code-agent/src/server.ts` sets `requestTimeout: 120000`. | No repo-wide Fastify `bodyLimit`; many services still rely on defaults. |
| INT-1508 - Secrets can leak in logs | Todo | `logIncomingRequest` redacts request headers through `packages/common-core/src/redaction.ts`. | No broad Pino `logger.redact` config was found; body/query/service-specific structured logs still need audit. |
| INT-1512 - External fetches without timeouts | Canceled | Some newer clients use `AbortSignal.timeout` or explicit timeout wrappers. | Several HTTP clients still call `fetch` without a signal, including Notion and usage sinks; the issue remains a system-wide hardening task. |

## Canceled Or Rejected In Linear

The following 18 child issues are Canceled in Linear:

`INT-1480`, `INT-1503`, `INT-1504`, `INT-1506`, `INT-1507`, `INT-1510`, `INT-1511`,
`INT-1512`, `INT-1513`, `INT-1515`, `INT-1516`, `INT-1518`, `INT-1521`, `INT-1522`,
`INT-1523`, `INT-1526`, `INT-1527`, `INT-1528`.

Do not treat them as fixed. INT-1560 found no recorded technical rejection rationale. Current-code
evidence shows several canceled findings are still valid:

- INT-1480: `docker/code-worker/entrypoint.sh` still uses dangerous worker flags.
- INT-1503: the web Auth0 client still uses `cacheLocation="localstorage"`.
- INT-1504: CORS remains permissive in shared HTTP setup; CSP/HSTS coverage is incomplete.
- INT-1506: worker shared credential mounts remain read-write in `docker-volume.ts`.
- INT-1511: generated/shared/static content bucket modules still expose `allUsers`.
- INT-1515: worker metadata egress protection is not enforced by the entrypoint.
- INT-1518: Firestore PITR remains disabled in Terraform.
- INT-1521: worker env/entrypoint still expose secrets and GCP credentials into the code task environment.
- INT-1522: Cloud Function source artifacts still use `force_destroy`; versioning is not evident.
- INT-1523: Terraform still deploys many Cloud Run services with mutable `:latest` images.
- INT-1526: orchestrator status/log signing still derives from a shared orchestrator secret.
- INT-1528: `api-docs-hub` registers Swagger UI at `/docs` with no app-level auth.

## Open Findings With No Full Implementation Evidence

The remaining open issues should be treated as unresolved unless a later implementation PR is found
outside the current branch history:

`INT-1474`, `INT-1475`, `INT-1476`, `INT-1478`, `INT-1479`, `INT-1481`, `INT-1482`,
`INT-1484`, `INT-1485`, `INT-1487`, `INT-1488`, `INT-1489`, `INT-1491`, `INT-1492`,
`INT-1493`, `INT-1495`, `INT-1496`, `INT-1497`, `INT-1498`, `INT-1499`, `INT-1500`,
`INT-1501`, `INT-1502`, `INT-1505`, `INT-1509`, `INT-1514`, `INT-1517`, `INT-1519`.

Examples of current-code evidence:

- INT-1474: Terraform still grants unauthenticated Cloud Run access through `allUsers`.
- INT-1475: shared `X-Internal-Auth` remains in `packages/common-http/src/auth/internalAuth.ts`.
- INT-1476: Pub/Sub helpers still accept Google push headers such as `from: noreply@google.com`.
- INT-1479: image proxy and metadata fetchers still accept arbitrary HTTP(S) URLs without private-IP
  or redirect re-validation.
- INT-1481: code-worker Docker setup still activates a mounted GCP service account and sources repo
  secrets for the worker environment.
- INT-1482: worker isolation still mounts the main `.git` directory read-write.
- INT-1484: OAuth state is still base64url JSON, not HMAC-signed or server-stored.
- INT-1485: GitHub OAuth still requests `repo` plus `read:user`.
- INT-1487: shared Fastify/CORS setup still uses `origin: true` patterns.
- INT-1488: `firebase.json` references `firestore.rules`, but that rules file is absent.
- INT-1489: research share-token generation still uses `Math.random()`.
- INT-1491: `apps/web/src/components/MarkdownContent.tsx` still imports `rehypeRaw`.
- INT-1492: research HTML generation still uses `marked.parse()` without sanitizer evidence.
- INT-1497: OAuth connection redirect URIs still derive from forwarded host headers.
- INT-1499: `/auth/firebase-token` still creates a Firebase custom token for the authenticated
  request user without stronger binding evidence.
- INT-1501: Terraform still grants broad project/IAM/admin roles to the Claude/code dev service account.
- INT-1502: Workload Identity Federation maps `attribute.ref`, but repository-level bindings do not
  enforce branch restrictions.
- INT-1517: worker creation still includes `NET_RAW`; forensic mode includes `SYS_PTRACE`.

## Work Worth Implementing Now

Recommended next work, in priority order:

- [ ] Worker containment cluster: INT-1480, INT-1481, INT-1482, INT-1506, INT-1515, INT-1517,
  INT-1521. These findings define the most direct path from untrusted code task to host, repo,
  secrets, credentials, or cloud metadata.
- [ ] Service-to-service auth cluster: INT-1474, INT-1475, INT-1476, INT-1477. Replace public
  invokers, shared static internal tokens, Pub/Sub header trust, and partial scheduler OIDC with
  consistent IAM/OIDC verification.
- [ ] OAuth and identity cluster: INT-1484, INT-1485, INT-1497, INT-1498, INT-1499, INT-1527.
  Signed/server-stored state, narrower GitHub scopes, fixed redirect origins, and stronger token
  binding are still more valuable than polishing lower-severity findings.
- [ ] Browser/XSS/token-storage cluster: INT-1487, INT-1491, INT-1492, INT-1503, INT-1504,
  INT-1505. LocalStorage tokens, permissive CORS, raw markdown/HTML rendering, and incomplete
  security headers compound each other.
- [ ] SSRF and tenant-isolation cluster: INT-1478, INT-1479, INT-1488, INT-1509. This should cover
  user-derived IDs, URL fetch allowlists/private-address blocking, and deployable Firestore rules.
- [ ] Infrastructure supply-chain/IAM cluster: INT-1500, INT-1501, INT-1502, INT-1511, INT-1518,
  INT-1522, INT-1523. This should harden container users, overbroad service accounts, WIF branch
  restrictions, public buckets, Firestore PITR, source-artifact retention, and immutable images.
- [ ] Operational hardening cluster: INT-1490, INT-1494, INT-1507, INT-1508, INT-1512, INT-1514,
  INT-1519. Keep after the direct exploit-path clusters unless active abuse is observed.

## Lower Priority Or Needs Re-Scope

- INT-1510: Terraform state bucket hardening is important but needs an infrastructure ownership
  decision and is less directly app-exploitable than the worker/auth findings.
- INT-1513: Notion webhook exposure should be re-verified against current product behavior before
  implementation, because the direct side effect appears limited.
- INT-1516: Docker base-image and curl-install pinning is broad supply-chain hygiene; useful, but best
  scheduled as a repository-wide image policy rather than a one-off patch.
- INT-1528: API docs hub auth is straightforward, but lower risk than secrets, worker isolation,
  OAuth, and Cloud Run invocation exposure.

## Planning Decision

This is a PLAN-DOC task, not a SIMPLE issue edit and not a COMPLEX subtask split. The requested output
is an audit artifact and planning PR. It does not require creating implementation subtasks under
INT-1624; future implementation should create focused child issues from the work packages above if the
team decides to reopen the security hardening backlog.
