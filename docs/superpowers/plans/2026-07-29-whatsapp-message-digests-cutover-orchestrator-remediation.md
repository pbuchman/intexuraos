# WhatsApp Message Digests Cutover Orchestrator Remediation Plan

## Scope

Close the correctness gaps found during the focused Task 7 cutover review before the production
deployment wrapper is allowed to invoke the orchestrator. This remains part of the active WhatsApp
Message Digests goal and does not add a feature flag or a second deployment path for first
activation.

## Verifiable changes

1. Add focused RED tests proving the immutable release manifest ignores only runtime-generated
   directories while still changing for tracked source changes.
2. Preserve the original durable cutover start/deadline when the same deployment resumes, and select
   the candidate WhatsApp port only before the runtime-switch checkpoint; use the production port
   after that checkpoint, including activation, verification, and compensation.
3. Make pre-admission rollback report and retain every restoration failure instead of silently
   accepting partial compensation. Keep post-admission behavior fail-closed and forward-only.
4. Wire the verified GitHub release into an immutable remote release directory, invoke the cutover
   from the production wrapper, and give the workflow the required timeout and read-only GitHub plus
   Hetzner credentials.
5. Run shell syntax checks and the focused cutover/runtime tests. Do not run the repository-wide CI
   gate during this remediation.

## Focused verification

```bash
bash -n scripts/hetzner/cutover-message-digests.sh scripts/hetzner/github-actions-deploy.sh
pnpm exec vitest run scripts/__tests__/message-digest-cutover.test.ts scripts/__tests__/hetzner-runtime.test.ts
```
