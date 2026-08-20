# Secret Migration Status Report

Last updated: 2026-08-20 UTC

This report records only non-secret operational metadata. It contains no
credential values, package payloads, private-key material, reversible value
fingerprints, rendered environment data, or private evidence paths.

## Executive Status

The DEV and PROD package cutovers are complete on package version `2`.
Production is healthy on the reviewed `development` release, and local,
home-dev, worker, direct-origin, and public verification have passed. The
remaining migration work is cleanup and observation, not a runtime cutover.

The cleanup is intentionally split:

- Phase A removes legacy readers and disables legacy versions while retaining
  every container, so rollback remains possible;
- Phase B destroys the obsolete containers only after seven complete days of
  healthy Phase A evidence.

Phase A was applied on 2026-08-20. Its reversible observation window began at
`D_legacy=2026-08-20T16:41:14.034606179Z`. The earliest possible Phase B
boundary is therefore `2026-08-27T16:41:14.034606179Z`; reaching that time is
not sufficient by itself, because every daily health and audit gate must also
pass.

## Completed Evidence

| Area | Status | Non-secret result |
| --- | --- | --- |
| DEV and PROD packages | PASS | Both environments use exact numeric package version `2`. |
| Production rollout | PASS | Exact release attestation, PM2 `19/19`, semantic health, direct-origin and public matrices passed. |
| home-dev and workers | PASS | Atomic projections, package-only runtime, replacement worker image, terminal callback, and secret-isolation checks passed. |
| Rollback drill | PASS | Prior and forward package projections passed the required sampled observation. |
| Recovery and escrow | PASS | Two independent encrypted provider copies and eight offline reconstruction paths passed with zero Secret Manager reads. |
| Break-glass review | PASS | Two-person, exact-version, resource-level, maximum-60-minute design passed; no emergency grant was created. |
| Abandoned runtime key | COMPLETE | The disabled, never-used staged key was deleted on 2026-08-20 at 14:40 UTC; the active and disabled rollback keys were unchanged. |
| Phase A implementation | PASS | PRs `#2480` and `#2481` merged the reversible reader/container split and made `readers=false, containers=true` the authoritative Terraform desired state. |
| Phase A IAM removal | PASS | The saved-plan allowlist covered exactly `569` approved Terraform deletes and no create/update/container/App Check action. A credential self-removal interrupted the first apply after `191` deletes; an independent owner resumed only the exact `378` remaining deletes. The final targeted plan is clean. |
| Unmanaged legacy drift | PASS | Ten PromptVault resource accessors were removed after metadata-only proof of zero Secret Manager version access during the preceding 30 days. |
| Legacy version disable | PASS | All `34` frozen legacy containers remain. Their version inventory is `0 ENABLED`, `35 DISABLED`, and `7 DESTROYED`; resource-level accessor count is `0`. The separate empty DNS-token container also remains with zero accessors. |
| Post-Phase A runtime | PASS | PROD exact release/package attestation, `14/14` direct/public checks, PM2 `19/19`, and a non-activating package preflight passed. home-dev PM2 `22/22`, application package v2 `20/20`, orchestrator, Alloy, tunnel, and scheduler also passed. |
| Remaining Terraform drift | DEFERRED | The full, untargeted plan contains exactly two pre-existing App Check service-config deletes and no Secret Manager or project-service change. They were not applied or mixed into Phase A. |

## Phase A Applied Result

The reviewed implementation was merged to `development` and deployed before
the infrastructure change. The follow-up release attests exact application
SHA `ad7440fd63afb0cac89162616cabbc4a5f047229`, workflow run `32390862324`, and
secret package version `2`.

The first saved Terraform plan contained exactly `569` allowlisted legacy IAM
deletes. It contained zero additions, updates, Secret Manager containers,
secret versions, or App Check resources. The execution account's own broad
Secret Manager admin role was one of those deletes, so the first apply removed
`191` entries and then failed closed on `378` permission denials. No
out-of-scope resource changed. A fresh plan under an independent owner account
contained exactly those `378` remaining deletes; its apply passed, and the
same targeted plan now reports zero changes.

Live IAM inspection then found ten unmanaged PromptVault accessors outside the
Terraform state. The service account had zero `AccessSecretVersion` events in
the preceding 30 days, so those ten bindings were removed directly and the
resource-level legacy accessor count reached zero. Cloud Audit Log records
`35/35` successful `DisableSecretVersion` operations between
`2026-08-20T16:40:27.147626224Z` and
`2026-08-20T16:41:14.034606179Z`. No version or container was destroyed by
Phase A.

The prior passive 72-hour legacy-read window was intentionally superseded by
this accelerated reversible path and must not be cited as a completed gate.
Two known Cloud Build P4SA project-level Secret Manager admin bindings remain
separately tracked; the legacy versions are disabled, and their least-privilege
cleanup is scheduled during the reversible soak with a connection canary.
The broad admin count is exactly `2`; the removed custom Cloud Build accessor
and removed technical-account admin both have live count `0`.

## Required Later Work

| Earliest gate | Required action | PASS condition | Why it is deferred |
| --- | --- | --- | --- |
| 2026-08-21 13:33 UTC | Close the Firebase 24-hour observation query. | Old-key request count `0`, replacement traffic positive, exhaustive query, DEV/PROD browser smokes remain healthy. | Recent old-key traffic proved cached clients still existed; deleting now could break sign-in or token refresh. |
| After Firebase observation PASS | Remove the old Firebase key through reviewed Terraform and close the matching secret-scanning alert as revoked. | Exact old resource absent, replacement restrictions unchanged, browser smokes PASS, alert resolved. | Deletion before the observation gate is unnecessary availability risk. |
| Daily through 2026-08-27 | Continue the disabled runtime-key soak. | Eight state snapshots, seven non-overlapping 24-hour intervals, replacement use positive, health/canary PASS, no re-enable or credential failures. | The disabled key is the only immediate rollback for a previously active credential. |
| No earlier than 2026-08-27 16:06 UTC | Delete the previous runtime key. | All seven windows pass after the required logging lag. | Earlier deletion would remove the rollback before rare consumers are excluded. |
| No earlier than 2026-08-27 16:41:14 UTC | Run legacy Phase B. | Seven complete Phase A intervals PASS; recovery, break-glass, health, IAM, and version-state evidence PASS; saved plan contains only obsolete container deletes. | Container deletion irreversibly deletes its versions. |
| During the reversible soak | Reduce retained Cloud Build connection IAM to its exact secret-level dependency. | Connection remains complete, source-reference canary passes before and after, project-level Secret Manager admin count is zero, final plan is clean. | Requires separate Terraform adoption and an exact two-delete plan; it must not be mixed with container destruction. |
| After every cleanup gate | Reconcile Terraform and documentation. | Clean full plans, full CI, current package/version/production attestations, no stale acceptance items. | Final closure must reflect live state rather than planned state. |

## Explicitly Forbidden Shortcuts

- Do not delete the legacy containers during Phase A.
- Do not delete the previous runtime key before its complete seven-day gate.
- Do not delete the old Firebase key before the mature 24-hour query passes.
- Do not put secret values or secret-version payloads in Terraform state.
- Do not combine unrelated App Check, provider, package, or native-secret
  changes with either cleanup phase.
- Do not treat an interrupted or shortened passive legacy-read window as a
  72-hour PASS.

## Closure Definition

The migration is complete only when Firebase cleanup, both runtime-key delete
gates, legacy Phase B, Cloud Build least-privilege cleanup, final clean
Terraform plans, full CI, runtime health, audit evidence, and this report all
agree with the live environment.
