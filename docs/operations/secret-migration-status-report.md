# Secret Migration Status Report

Status: **COMPLETE**

Completed: 2026-08-21 UTC

Production release: `b303eb5e000a265d3c029382036e6cd2616c425c`

This report contains metadata only. It does not contain secret values,
reversible fingerprints, rendered environments, or private evidence paths.

## Result

The IntexuraOS secret migration and the security cutover described in the
[final cutover plan](./secret-exposure-final-cutover-plan.md) are complete.
DEV and PROD run only on the final configuration. There is no rollback,
dual-read, compatibility, or retained legacy-secret path.

| Area | Final state |
| --- | --- |
| Application release | Home Dev and PROD run exact SHA `b303eb5e000a265d3c029382036e6cd2616c425c`. |
| Secret packages | DEV `v3`, PROD `v3`, internal-auth `v3`, Speechmatics `v2`; all earlier versions destroyed. |
| Legacy Secret Manager | `35` obsolete containers absent: `34` legacy application containers plus the empty Cloudflare DNS token container. |
| Remaining application secrets | Exactly four package/native containers remain. Six additional containers are Google-managed GitHub connection OAuth tokens. |
| Firebase | Old key UID `d8251549-1bde-49c0-82a7-b0525a2fe688` absent. Restricted replacement UID `e062efa4-59bc-4dd5-8d93-54375943463a` remains. GitHub secret-scanning alert `#1` is resolved as revoked. |
| Runtime service account | Old key `ecd947dfc08351f186efc8f23c04c10b2d3c482a` absent. Replacement key `4bf7371e272b2c67b6d0bd59cd52cae7daf18efc` remains. |
| Cloud Build | Project-level Secret Manager admin bindings: `0`. Exact Google-managed OAuth-secret accessor: `1`. GitHub connection is `COMPLETE`. |
| Direct LLM providers | Removed. Application inference uses OpenRouter. Subscription-authenticated Claude and Codex CLI code-task runners are the only exception. |
| Gemini | Generative Language API disabled. The exposed Gemini key is absent. Security-change logging and alerting are enabled. The project-scoped Gemini API emergency spend cap is enforced. |
| DEV edge | Cloudflare Access protects the browser surface. Only the frozen, authenticated webhook allowlist bypasses Access. Home Dev serves a static build; Vite internals and source maps are not public. |
| Deployment automation | Production deployment is manual-only. The legacy Home Dev webhook service is disabled and masked. |

## Verification

- Home Dev: PM2 `19/19`, backend health `19/19`, orchestrator ready,
  Alloy ready and healthy, static web healthy.
- PROD: workflow run `32461543306`, PM2 `19/19`, backend health `19/19`,
  nginx and Alloy healthy, public and direct-origin checks pass.
- Transcription: workflow run `32462497079`, Cloud Build
  `3376a7b7-8b7e-4d52-b53d-57cfa9a8d2c0`, revision
  `intexuraos-transcription-dev-00020-viz` active, exact two-secret reads,
  zero read errors.
- Anonymous DEV requests to `/`, `/src/*`, `/@vite/*`, `/@fs/*`, `.env`,
  source maps, and the retired deployment webhook are blocked by Access.
- The final targeted Terraform reconciliation for removed resources reports
  zero resource and output changes. Unrelated provider drift was not applied.

## Terraform execution record

All destructive plans were generated and applied sequentially. Each saved plan
was checked against an exact address/action allowlist before apply.

| Plan | Applied result |
| --- | --- |
| Cloud Build project-admin cleanup | `0` add, `0` change, `2` destroy |
| DEV obsolete resources | `0` add, `0` change, `36` destroy: 35 obsolete secret containers plus the old Firebase key |
| Hetzner legacy bootstrap | Already absent; targeted plan no-op |
| Old package/native versions | DEV `v1-v2`, PROD `v1-v2`, internal-auth `v2`, Speechmatics `v1` destroyed |
| Old runtime key | Deleted |

## Separate billing follow-up

The security migration is not blocked by the Google billing dispute. The
existing `20 PLN` account budget remains alert-only. A separate
`IntexuraOS Gemini emergency cap`, scoped to the `Gemini API Keys` project and
the `Gemini API` service, is enforced.

The concise reply for case `#74312245` has been prepared with the verified
incident totals (`237.691246 PLN`, `1,068` calls) and remediation evidence.
Per the account owner's instruction, the automation must not send it. Delivery
and any billing credit remain owner-controlled Google-account actions and must
not be represented as completed until Google confirms receipt and resolution.

## Terminal state

- No legacy reader, container, package version, provider key, Firebase key, or
  runtime key listed for deletion remains active.
- No production rollback or compatibility path is retained.
- Future defects are handled by fix-forward while the affected service remains
  stopped.
- This report and live infrastructure describe the same final state.
