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

## Immediate Work In Progress

The reviewed Phase A implementation separates reader removal from container
deletion. Before live execution it must pass Terraform validation, a saved-plan
address/action allowlist, full repository CI, pull-request checks, and merge to
`development`. Live Phase A then requires:

A full read-only Terraform audit on 2026-08-20 classified `572` delete actions:
`569` legacy-reader actions belong to Phase A, while three unrelated App Check
actions were rejected from scope. The live apply must use a separately saved
targeted plan containing exactly the `569` approved deletes and no other
action.

1. `legacy_secret_readers_enabled=false` with
   `legacy_secret_containers_enabled=true`;
2. zero unreviewed or unrelated Terraform actions;
3. live zero-reader proof with all legacy containers retained;
4. metadata-only disable of every enabled version in the frozen legacy set;
5. complete post-change health and package-only canary matrices;
6. a recorded `D_legacy` boundary for the seven-day reversible soak.

This section will be replaced with the exact applied result and timestamps
after the live Phase A proof completes.

## Required Later Work

| Earliest gate | Required action | PASS condition | Why it is deferred |
| --- | --- | --- | --- |
| 2026-08-21 13:33 UTC | Close the Firebase 24-hour observation query. | Old-key request count `0`, replacement traffic positive, exhaustive query, DEV/PROD browser smokes remain healthy. | Recent old-key traffic proved cached clients still existed; deleting now could break sign-in or token refresh. |
| After Firebase observation PASS | Remove the old Firebase key through reviewed Terraform and close the matching secret-scanning alert as revoked. | Exact old resource absent, replacement restrictions unchanged, browser smokes PASS, alert resolved. | Deletion before the observation gate is unnecessary availability risk. |
| Daily through 2026-08-27 | Continue the disabled runtime-key soak. | Eight state snapshots, seven non-overlapping 24-hour intervals, replacement use positive, health/canary PASS, no re-enable or credential failures. | The disabled key is the only immediate rollback for a previously active credential. |
| No earlier than 2026-08-27 16:06 UTC | Delete the previous runtime key. | All seven windows pass after the required logging lag. | Earlier deletion would remove the rollback before rare consumers are excluded. |
| `D_legacy+168h` | Run legacy Phase B. | Seven complete Phase A intervals PASS; recovery, break-glass, health, IAM, and version-state evidence PASS; saved plan contains only obsolete container deletes. | Container deletion irreversibly deletes its versions. |
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
