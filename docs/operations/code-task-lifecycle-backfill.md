# Code-task lifecycle time backfill

This is the only supported production procedure for repairing retained
`code_tasks` lifecycle timestamps and then reconciling
`task_group_summaries` / `user_group_counts`. Every write batch is limited to
200 work items, bound to one exact deployed commit, protected by an
owner-fenced Firestore lease, and recorded in an immutable rollback journal.

The six confirmed dispatch-auth failures that motivated the repair are:

- `task_488aa3c6-1413-47ea-a1c7-9593e5aca5a2`
- `task_6713e082-4806-41a0-b0f2-763db07404f1`
- `task_95ecfbc5-233d-4a1f-b7ad-e6a0223f6fd4`
- `task_e8d7ab84-33fb-4746-8c77-4a1b95823f0c`
- `task_a5d59442-06c5-47f4-8f2a-d03489e655ce`
- `task_166001f8-3d65-4397-932d-9c930363e338`

For these documents, the authoritative failure time is retained dispatch
terminal evidence, not a later generic `updatedAt` write.

## Preconditions

1. Work from the exact deployed `development` commit. Record its lowercase
   40-character SHA as `RELEASE_SHA` and confirm that direct-origin and public
   `/deployment.json` return the identical three-field rollout proof
   (`commitSha`, numeric `workflowRunId`, `deployedAt`).
2. Execute on the Hetzner production host as `deploy`, from `/opt/intexuraos`.
   The loopback URLs prove the origin and the HTTPS URLs independently prove
   the public edge.
3. Use the retained-production service account for project
   `intexuraos-dev-pbuchman`. No Firestore emulator variable may be set.
4. Keep every private journal under the deploy user's mode-0700 state path.

```bash
cd /opt/intexuraos
set -a
source /etc/intexuraos/.env.prod
set +a
export RELEASE_SHA='REPLACE_WITH_EXACT_40_HEX_SHA'
export GOOGLE_APPLICATION_CREDENTIALS='/home/deploy/runtime-sa-key.json'
export INTEXURAOS_ENVIRONMENT='prod'
export INTEXURAOS_RUNTIME='prod'
export INTEXURAOS_COMMIT_SHA="${RELEASE_SHA}"
export INTEXURAOS_LIFECYCLE_DIRECT_DEPLOYMENT_URL='http://127.0.0.1:18080/deployment.json'
export INTEXURAOS_LIFECYCLE_PUBLIC_DEPLOYMENT_URL='https://intexuraos.cloud/deployment.json'
export INTEXURAOS_LIFECYCLE_DIRECT_HEALTH_URL='http://127.0.0.1:18080/api/code/health'
export INTEXURAOS_LIFECYCLE_PUBLIC_HEALTH_URL='https://intexuraos.cloud/api/code/health'
export INTEXURAOS_LIFECYCLE_JOURNAL_DIRECTORY='/home/deploy/.local/state/intexuraos/code-task-lifecycle-backfill/journals'
install -d -m 700 "${INTEXURAOS_LIFECYCLE_JOURNAL_DIRECTORY}"
chmod 700 "${INTEXURAOS_LIFECYCLE_JOURNAL_DIRECTORY}"
umask 077
```

The sourced production env supplies the existing Sentry DSN without placing a
placeholder or secret in shell history. **STOP** if either loopback URL does
not return the same no-store JSON contract as its public counterpart.

## Dry-run audit

Dry-run performs no writes and may cover all phases. Capture its sanitized
output in a mode-0600 report.

```bash
umask 077
pnpm --filter @intexuraos/code-agent backfill:lifecycle-time -- \
  --dry-run \
  --project=intexuraos-dev-pbuchman \
  --phase=all \
  --page-size=200 > lifecycle-dry-run.json
chmod 600 lifecycle-dry-run.json
```

**STOP** if the report contains invalid tasks, invalid summaries, unknown
orphans, an unexpected total, or any technical error. Resolve the discrepancy
and repeat dry-run; never add a force flag.

## Apply task batches

Only one explicit phase is legal in apply mode. `--limit=200` and the exact
release SHA are mandatory. Omit `--cursor` for the first batch. Pass the
returned cursor on the next batch only when `hasMore` is `true`.

```bash
pnpm --filter @intexuraos/code-agent backfill:lifecycle-time -- \
  --apply \
  --project=intexuraos-dev-pbuchman \
  --phase=tasks \
  --page-size=200 \
  --limit=200 \
  --expected-release-sha="${RELEASE_SHA}" > lifecycle-tasks-batch.json
chmod 600 lifecycle-tasks-batch.json
```

The program performs exact deployment proof D1, semantic code-agent health H,
and exact deployment proof D2; creates and fsyncs the immutable journal; takes
the release-bound owner/fence lock; repeats D1→H→D2; and only then performs
CAS writes. `hasMore:false` is the terminal page and intentionally has no
cursor. A zero-change batch can still advance because unchanged/skipped work
items count toward paging.

Read only the safe paging fields from the result. When `hasMore` is `true`, a
non-empty cursor is mandatory and must be passed to the next uniquely named
batch report. When `hasMore` is `false`, the cursor must be absent.

```bash
node -e '
  const r = require("./lifecycle-tasks-batch.json");
  if (r.hasMore !== true || typeof r.cursor !== "string" || r.cursor.length === 0) process.exit(1);
  process.stdout.write(r.cursor);
' > next-cursor.txt
chmod 600 next-cursor.txt
NEXT_CURSOR="$(cat next-cursor.txt)"
```

## Required off-host checkpoint

After every successful batch—and before the next one—copy its journal off the
execution host. The filename is `<operationId>-<phase>.json`; the expected hash
is `journalSha256` in the safe result.

```bash
install -d -m 700 "$HOME/intexuraos-lifecycle-journals"
scp deploy@162.55.210.48:/home/deploy/.local/state/intexuraos/code-task-lifecycle-backfill/journals/OPERATION_ID-tasks.json \
  "$HOME/intexuraos-lifecycle-journals/"
chmod 600 "$HOME/intexuraos-lifecycle-journals/OPERATION_ID-tasks.json"
shasum -a 256 "$HOME/intexuraos-lifecycle-journals/OPERATION_ID-tasks.json"
```

On Linux, `sha256sum` is equivalent. Compare all 64 lowercase hex characters
with `journalSha256`. **STOP** on copy or hash mismatch. Never print, attach,
or send journal contents: they contain lossless private preimages. **The next
batch command is forbidden until the off-host copy succeeds and its complete
hash matches.**

Only after that checkpoint may the next task batch run:

```bash
pnpm --filter @intexuraos/code-agent backfill:lifecycle-time -- \
  --apply \
  --project=intexuraos-dev-pbuchman \
  --phase=tasks \
  --page-size=200 \
  --limit=200 \
  --cursor="${NEXT_CURSOR}" \
  --expected-release-sha="${RELEASE_SHA}" > lifecycle-tasks-batch-next.json
chmod 600 lifecycle-tasks-batch-next.json
```

## Resume after a crash

If a batch stopped after journal creation or after some CAS writes, keep the
journal unchanged. Wait for the 30-minute lease to expire, then resume using
the exact journal and hash. Resume repeats both production gates and
idempotently classifies every entry as changed or already applied.

```bash
pnpm --filter @intexuraos/code-agent resume:lifecycle-time -- \
  --project=intexuraos-dev-pbuchman \
  --journal=/absolute/private/path/OPERATION_ID-tasks.json \
  --journal-sha=REPLACE_WITH_64_HEX_SHA \
  --expected-release-sha="${RELEASE_SHA}"
```

Never create a new operation to bypass a lock. A stale lease can be taken over
only by the same operation, phase, release, and journal hash.

After the terminal task page, prove task convergence before summaries:

```bash
pnpm --filter @intexuraos/code-agent backfill:lifecycle-time -- \
  --dry-run --project=intexuraos-dev-pbuchman --phase=tasks --page-size=200 \
  > lifecycle-tasks-convergence.json
chmod 600 lifecycle-tasks-convergence.json
```

Continue only when `tasks.changed=0`, `tasks.invalid=0`, and no technical error
is present.

## Apply summary batches

Complete all task batches, repeat the full dry-run, and only then run summary
batches. The same cursor, journal-copy, and **STOP** rules apply.

```bash
pnpm --filter @intexuraos/code-agent backfill:lifecycle-time -- \
  --apply \
  --project=intexuraos-dev-pbuchman \
  --phase=summaries \
  --page-size=200 \
  --limit=200 \
  --expected-release-sha="${RELEASE_SHA}" > lifecycle-summaries-batch.json
chmod 600 lifecycle-summaries-batch.json
```

Summary journals contain lossless raw summary/count preimages, deterministic
postimages, source-task proof, and nanosecond-precision timestamps. Counts for
multiple groups of one user form an ordered chain; do not reorder entries.

Read the safe paging fields before continuing:

```bash
node -e '
  const r = require("./lifecycle-summaries-batch.json");
  if (r.hasMore !== true || typeof r.cursor !== "string" || r.cursor.length === 0) process.exit(1);
  process.stdout.write(r.cursor);
' > next-summary-cursor.txt
chmod 600 next-summary-cursor.txt
NEXT_SUMMARY_CURSOR="$(cat next-summary-cursor.txt)"
```

Copy and verify the summary journal off-host before running another summary
batch:

```bash
install -d -m 700 "$HOME/intexuraos-lifecycle-journals"
scp deploy@162.55.210.48:/home/deploy/.local/state/intexuraos/code-task-lifecycle-backfill/journals/OPERATION_ID-summaries.json \
  "$HOME/intexuraos-lifecycle-journals/"
chmod 600 "$HOME/intexuraos-lifecycle-journals/OPERATION_ID-summaries.json"
shasum -a 256 "$HOME/intexuraos-lifecycle-journals/OPERATION_ID-summaries.json"
```

Compare the complete hash with `journalSha256`. **The next summary batch
command is forbidden until the off-host copy succeeds and its complete hash
matches.** Only then may it run:

```bash
pnpm --filter @intexuraos/code-agent backfill:lifecycle-time -- \
  --apply \
  --project=intexuraos-dev-pbuchman \
  --phase=summaries \
  --page-size=200 \
  --limit=200 \
  --cursor="${NEXT_SUMMARY_CURSOR}" \
  --expected-release-sha="${RELEASE_SHA}" > lifecycle-summaries-batch-next.json
chmod 600 lifecycle-summaries-batch-next.json
```

Repeat this result-parse → off-host copy and full-hash verification → next
batch sequence for every summary page. After `hasMore:false`, run a
summary-only dry-run and require `summaries.changed=0`,
`summaries.invalid=0`, and `summaries.unknownOrphans=0`.

## Final convergence

Run one last complete audit:

```bash
pnpm --filter @intexuraos/code-agent backfill:lifecycle-time -- \
  --dry-run --project=intexuraos-dev-pbuchman --phase=all --page-size=200 \
  > lifecycle-final-dry-run.json
chmod 600 lifecycle-final-dry-run.json
```

Completion requires task `changed=0` and `invalid=0`; summary `changed=0`,
`invalid=0`, `unknownOrphans=0`, `missingSummaries=0`, and
`semanticUpdates=0`; expected scan totals; no active maintenance lock; and an
off-host, hash-verified journal for every applied batch. Otherwise **STOP**.

## Rollback

Rollback verifies file type, mode 0600, byte hash, release, deployment/health
gates, and the owner-fenced lock. It preflights the entire reverse state
(including chained counts) before the first write, then re-checks every entry
with CAS while restoring in reverse order.

```bash
pnpm --filter @intexuraos/code-agent rollback:lifecycle-time -- \
  --project=intexuraos-dev-pbuchman \
  --journal=/absolute/private/path/OPERATION_ID-tasks.json \
  --journal-sha=REPLACE_WITH_64_HEX_SHA \
  --expected-release-sha="${RELEASE_SHA}"
```

**STOP** immediately on `DEPLOYMENT_*`, `HEALTH_*`, `LOCK_*`, `JOURNAL_*`,
source-proof, CAS-conflict, invalid-data, missing-cursor, or hash errors. Do not
edit a journal, overwrite a document manually, retry with a different SHA, or
continue to the next batch. Preserve the report and encrypted off-host journal
for review.
