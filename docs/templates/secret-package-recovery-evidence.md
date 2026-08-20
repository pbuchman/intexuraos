# Secret Package Recovery Evidence

Copy this template to the private incident/change record. Never paste a secret
value, payload, private key, token fragment, hash, checksum, or suffix into the
record.

## Scope

- Incident/change ID:
- Environment: `dev` / `prod`
- Recovery coordinator:
- Started (UTC):
- Completed (UTC):
- Elapsed time:
- Package secret ID:
- Package numeric version:
- Rollback numeric version:
- Candidate receipt path retained privately: yes / no

## Source and owner gates

- Recovery inventory revision:
- Member owner coverage: PASS / FAIL
- Authoritative recovery source coverage: PASS / FAIL
- Recovery methods exercised / expected:
- Provider account access: PASS / FAIL
- Coordinated-rotation dependencies: PASS / FAIL
- Authoritative metadata cross-check: PASS / FAIL
- Offline escrow availability (two independent copies): PASS / FAIL
- Offline escrow reconstruction drill: PASS / FAIL
- Environment members reconstructed / expected:
- File members reconstructed / expected:
- Bootstrap identity restored and independently verified: PASS / FAIL
- Unknown, unavailable, or disputed authoritative source count:

Do not list values or value-derived fingerprints. If a member failed, record
only its manifest name, owner, reason category, and remediation due date.

## Offline reconstruction gates

- Private input files are regular, non-symlink, and mode `0600`: PASS / FAIL
- Full manifest membership validator: PASS / FAIL
- Secret Manager reads during full recovery: `0` / FAIL
- Candidate written atomically as mode `0600`: PASS / FAIL
- No secret values, payloads, hashes, or suffixes in stdout/stderr/evidence: PASS / FAIL

## Publication and verification gates

- Publication receipt state: `publishing` / `pending-verification` / `verified`
- Durable receipt reserved before version creation: PASS / FAIL
- Returned numeric version recorded before readback, or exact ambiguous version reconciled: PASS / FAIL
- Exact-version server CRC32C and byte readback: PASS / FAIL
- Renderer schema/member/file-mode checks: PASS / FAIL
- Environment canary result: PASS / FAIL
- Rollback drill result: PASS / FAIL
- Final active numeric version:

## Audit and approval

- Operator:
- Reviewer:
- Two-person destructive-cleanup approval (if applicable):
- Data Access audit query window:
- Unexpected package/member access count:
- Remediation items and due dates:
- Final disposition: PASS / FAIL
