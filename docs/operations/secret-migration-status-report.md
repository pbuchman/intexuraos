# Secret Migration Status Report

Status: **COMPLETE**

Last updated: 2026-08-21 UTC

Execution authority:
[Secret Exposure Final Cutover Plan](./secret-exposure-final-cutover-plan.md).
That owner-approved destructive cutover superseded the earlier rollback,
compatibility, soak, Phase A/B, and delayed-cleanup instructions.

This report contains operational metadata only. It contains no credential
values, package payloads, private-key material, reversible value fingerprints,
rendered environment data, or private evidence paths.

## Final Result

The irreversible security cutover and its follow-up remediation are complete.
The application now uses only the final package and native-secret versions,
the final runtime service-account key, and the managed restricted Firebase
browser key. Obsolete keys, versions, containers, readers, compatibility
paths, direct provider integrations, and rollback state are absent.

The implementation was delivered by PR `#2486` and the focused remediation by
PR `#2493`. Production was subsequently verified on `development` commit
`29ab12f39a2f62deb4e8835cc9e0acc67d800f4a`, deployment run `32501443955`, and
PROD package version `4`.

## Completion Evidence

| Area | Status | Non-secret result |
| --- | --- | --- |
| Secret inventory | PASS | Four application Secret Manager containers remain, plus the Google-managed Cloud Build connection token. Every application container has exactly one enabled version; all prior application versions are destroyed. |
| Runtime identity | PASS | Exactly one user-managed Hetzner runtime key remains enabled. Both retired runtime keys are deleted, replacement authentication is positive, and the completed 24-hour windows contained zero retired-key authentication and zero operational credential failures. |
| Firebase | PASS | The compromised key is deleted and its GitHub secret-scanning alert is resolved as revoked. The Firebase Web App is associated with the managed restricted replacement; its restrictions remain exactly three approved browser origins and four Firebase APIs. A transient unused Firebase-created key was proven absent from DEV and PROD static bundles and then deleted. |
| Firebase desired state | PASS | Terraform pins the Firebase Web App to the managed restricted key, preventing Firebase from auto-associating or creating a broader key during future applies. |
| Cloud Build | PASS | The connection retains one exact secret-level accessor, has zero project-level Secret Manager admin bindings, and the Google-managed connection token is retained intentionally. |
| Legacy Secret Manager state | PASS | All obsolete legacy containers, readers, resource-level accessors, broad project roles, disabled versions, and compatibility controls are absent. |
| Package-only runtime | PASS | DEV and PROD use final numeric package versions and final native-secret versions. No runtime performs direct Secret Manager reads or legacy sync. |
| Home Dev and production | PASS | Static DEV web, edge policy, package projections, services, workers, direct-origin endpoints, public endpoints, semantic health, browser flows, and deployment attestations passed. Production direct/public verification passed `14/14`, and the non-printing credential canary passed. |
| Recovery and break-glass | PASS | Two independent encrypted recovery copies and eight offline reconstruction paths passed with zero Secret Manager reads. The two-person, exact-version, maximum-60-minute break-glass design passed without creating an emergency grant. |
| CI and infrastructure | PASS | The final push-triggered full-repository gate passed. Focused remediation CI, Terraform validation, exact-plan verification, static-bundle scans, and scoped live reconciliation passed. The known unrelated App Check drift was not applied. |
| Provider incident | SENT | Google Cloud support case `#74312245` was reopened and the unauthorized-usage correction request was sent. Google acknowledged the case; the provider's billing decision is external follow-up, not a cutover gate. |

## Counterfactual Review Of Former Time Gates

The prior automation requested daily runtime-key observations, a 24-hour
Firebase window, a 72-hour legacy-read window, and a seven-day Phase B delay.
Those instructions are no longer executable authority.

- **Runtime keys:** keeping the previously active key would preserve rollback,
  but the approved cutover explicitly removed rollback. Both retired keys are
  already deleted. Recreating or observing them would weaken the final state
  and provide no equivalent safety evidence.
- **Firebase:** a mature observation window would reduce uncertainty about old
  cached clients, but the final plan accepted downtime and required immediate
  revocation. The old key is deleted, signed-in DEV/PROD browser reads pass,
  replacement usage is positive, and both deployed bundles reference only the
  managed replacement. There is no safe or useful reason to restore the old
  key for another window.
- **Legacy Secret Manager:** passive T1 classification could only observe state
  that no longer exists. All legacy containers and readers were intentionally
  destroyed under exact-set plans. Running the old T1 block would therefore be
  misleading, not conservative.
- **Phase B:** the former reversible retention strategy was explicitly
  superseded. Recovery and break-glass evidence passed before irreversible
  deletion, so no delayed cleanup remains.

## Later Follow-up

No timed secret-migration gate remains. The following items are ordinary
operations and must not be used to reopen the completed migration:

1. Monitor Google Cloud support case `#74312245` until the provider issues its
   billing decision; respond with metadata and chronology only, never a key.
2. Keep the existing API-key lifecycle and Gemini enablement alerts active.
3. Treat the excluded App Check Terraform drift as a separate reviewed change
   if it is ever intentionally reconciled.
4. Re-run ordinary health, static-bundle, and scoped Terraform verification
   after future relevant changes; do not recreate obsolete soak automations.

## Closure

All completion gates in the final cutover plan are satisfied. The historical
timed-gate automation must not execute its old runtime, Firebase, legacy T1, or
Phase B instructions against the final state.
