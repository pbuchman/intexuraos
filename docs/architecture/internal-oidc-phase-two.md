# Internal Service Auth — Phase Two: Per-Service Google OIDC

## Status

Design doc — not yet implemented.

This builds on **INT-1531** (Phase 1: shared HTTP client primitive and Google OIDC
verifier for Cloud Scheduler ingress).
Phase 2 is the long-term target architecture.

## Context

Internal service-to-service auth uses **two** mechanisms:

1. **Cloud Scheduler → service** — verified Google OIDC bearer
   (`createGoogleOidcVerifier({ audience: <own Cloud Run URL> })`).
2. **Service → service** — one static `X-Internal-Auth` shared secret
   (`validateInternalAuth` reads only `INTEXURAOS_INTERNAL_AUTH_TOKEN`). Rotation is
   an offline hard cutover with no fallback token.

Even with rotation, the shared secret is a **single point of failure**:

- Any compromised service can impersonate any other service.
- Scope creep: every new service inherits the same secret.
- Audit log records "valid token" but cannot identify the calling service.
- Rotation requires coordinated deploys across ~23 services.

## Target

Each app authenticates outbound calls using **its own GCP Service Account**, minting
an OIDC ID token via the GCP metadata server with `audience` = the callee's Cloud Run
URL. Each callee verifies the token using the existing
`createGoogleOidcVerifier({ audience })` primitive (already shipped in INT-1531).

After full migration:

- Delete the `X-Internal-Auth` header.
- Delete `validateInternalAuth` and `INTEXURAOS_INTERNAL_AUTH_TOKEN` from Secret Manager.
- Per-service IAM (`roles/run.invoker`) becomes the authoritative allow-list:
  caller A is granted `run.invoker` on callee B only when A is allowed to call B.

## Migration plan (no code in this design doc)

### Step 1 — Terraform: SA per app

Each app already has a dedicated GCP Service Account
(`module.iam.service_accounts["<app>"]`). What's missing is the IAM grant on each
callee. For every (caller, callee) pair, add:

```hcl
resource "google_cloud_run_v2_service_iam_member" "caller_can_invoke_callee" {
  project  = var.project_id
  location = var.region
  name     = local.services.<callee>.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${module.iam.service_accounts["<caller>"]}"
}
```

The full pair list comes from grepping `apps/*/src/infra/http/*HttpClient.ts`
and the `internal-clients` package consumers (see INT-1531 inventory).

### Step 2 — Shared client: optional `authMode`

Extend `createInternalHttpClient` (shipped in INT-1531):

```ts
export interface InternalHttpClientConfig {
  baseUrl: string;
  logger: InternalHttpClientLogger;
  defaultTimeoutMs?: number;
  /**
   * Authentication mode.
   * - 'shared-secret' (Phase 1): static X-Internal-Auth header from `token`.
   * - 'oidc' (Phase 2): mint Google OIDC token per request via metadata server.
   */
  authMode: 'shared-secret' | 'oidc';
  token?: string;        // required for 'shared-secret'
  audience?: string;     // required for 'oidc' — callee's Cloud Run URL
  identityClient?: IdTokenFetcher; // injected for tests
}
```

The OIDC token-minting primitive already exists in `google-auth-library`:

```ts
import { GoogleAuth } from 'google-auth-library';

const auth = new GoogleAuth();
const idClient = await auth.getIdTokenClient(audience);
const idToken = await idClient.idTokenProvider.fetchIdToken(audience);
// header: Authorization: Bearer <idToken>
```

Cache the client per audience (the underlying impl handles token reuse + refresh).

### Step 3 — Feature flag per call site

Add an env var per consumer like `INTEXURAOS_<CONSUMER>_<CALLEE>_AUTH_MODE`
(default `'shared-secret'`). Flip them one at a time, watch logs for verifier
rejections, then mark stable.

### Step 4 — Sunset the shared secret

Once every call site has been on `oidc` for >= 2 weeks with zero rejection logs:

1. Remove `validateInternalAuth` from every route's auth chain (replace with
   `createGoogleOidcVerifier`).
2. Delete `INTEXURAOS_INTERNAL_AUTH_TOKEN` from Secret Manager and Terraform.
3. Delete the env vars from `apps/*/src/index.ts` `REQUIRED_ENV` arrays and
   from `ecosystem.config.cjs`.
4. Delete the `X-Internal-Auth` header logic from `createInternalHttpClient`.
5. Delete the `'shared-secret'` arm of `authMode`.

## Local development

The metadata server is not available outside GCP. Two options:

1. **`gcloud auth print-identity-token --audiences=<URL>`** — paste into the
   Authorization header for ad-hoc curl. For long-running dev shells, set up a
   helper script that refreshes the token every 50 minutes (1-hour expiry).
2. **Stub the verifier in tests.** Existing `createGoogleOidcVerifier` is already
   mocked via `vi.mock('@intexuraos/internal-clients', ...)` in the OIDC tests
   under `apps/code-agent/src/routes/helpers/__tests__/internalAuth.oidc.test.ts`.
   Apply the same pattern in tests for any new OIDC-protected route.

For PM2 dev runs (`dev.intexuraos.cloud`), run with `INTEXURAOS_AUTH_MODE=shared-secret`
permanently — the metadata server isn't reachable from the home-dev VM, and
shared-secret auth remains a valid alternative as long as the token is set.
The `authMode` config field is per-client, so this stays a per-environment
override.

## Rollback plan

Each step is independently reversible:

- Step 2 (config flag default) — flip back to `'shared-secret'` for the
  affected call site; redeploy caller only.
- Step 4 (delete shared secret) — re-create the secret + env var; redeploy.
  This is the only step that requires re-deploying every service (because
  the env var has to come back into `REQUIRED_ENV`).

## Known risks

| Risk                                      | Mitigation                                                                                                                                     |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Metadata server flake during deploy → 5xx | Cache last good token for ≤ 30s; retry once with new token before failing.                                                                     |
| Audience drift after Cloud Run URL change | Use `INTEXURAOS_<callee>_URL` env vars (already in Terraform) as the audience source — same env that already holds the URL the caller fetches. |
| Test coverage gap for the new auth path   | Mandatory `nock` matcher on `Authorization: Bearer .+` in every per-service `client.test.ts`.                                                  |
| Local dev breakage                        | Keep `authMode: 'shared-secret'` default for `INTEXURAOS_RUNTIME=dev`.                                                                         |

## References

- Phase 1: [INT-1531](https://linear.app/pbuchman/issue/INT-1531) — shipped Phase 1 primitives.
- Verifier primitive: `packages/internal-clients/src/shared/oidcVerifier.ts`.
- Rotation runbook: `docs/runbooks/internal-auth-rotation.md`.
- Cross-cutting epic: [INT-1473](https://linear.app/pbuchman/issue/INT-1473).
