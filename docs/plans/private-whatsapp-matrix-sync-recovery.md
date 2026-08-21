# Private WhatsApp Matrix sync: fix, deploy, and backfill plan

> **Executor:** one SOL agent using `HIGH` reasoning.
>
> **Expected delivery:** a working production fix and complete backfill, not only code or
> an implementation PR. If the one-off backfill encounters an unusual Matrix event or
> media failure, use the agent/LLM to diagnose that concrete case, add a focused test or
> explicit skip rule, and resume the same idempotent run.

## Goal

Fix private WhatsApp synchronization, deploy the exact reviewed version to production,
restore all supported messages from the point where synchronization stopped, and prove
that live messages continue to synchronize.

Keep the permanent solution small. This incident needs:

1. two production bug fixes;
2. one limited-timeline safety check;
3. one reusable, idempotent backfill command;
4. controlled deployment and verification.

It does **not** need a new recovery platform, database, ingest route, or general workflow
engine.

## Verified incident state

The following was checked read-only on 20 August 2026:

- WhatsApp, mautrix-whatsapp, and Synapse are healthy. New WhatsApp events reach Matrix.
- The broken hop is `Matrix -> whatsapp-sync -> whatsapp-service`.
- The Matrix cursor last advanced at `2026-08-10T16:59:49.427Z`.
- From `2026-08-10T17:00:11Z`, the same batch repeatedly failed on a private media upload
  with HTTP 502. The adapter uploads media before ingesting the event batch, so one media
  object blocked every later message.
- On `2026-08-13`, project-wide Token Creator was removed from the mounted
  `claude-code-dev` identity. Since `13:30:09Z`, the adapter has failed first with 403 and
  missing `iam.serviceAccounts.getOpenIdToken`.
- The private-sync service account exists and is active, but the mounted credential is
  the wrong principal for its current self-binding.
- Firestore is consistent and the private account is active. The last persisted event is
  from `2026-08-10T16:42:18Z`; nothing was stored after the outage.
- A read-only Matrix sync from the frozen cursor returned 36 rooms and 306 visible
  timeline events. Twenty-seven timelines were `limited`.

There are therefore two consecutive causes:

1. **original blocker:** one media 502 froze the batch and cursor;
2. **current blocker:** the adapter can no longer mint the production ID token.

Fixing only IAM and restarting is unsafe: a limited Matrix response can omit older
timeline events, and the current adapter would save the new cursor anyway.

## Minimal permanent fix

### 1. Fix the production identity

- Stop mounting the `claude-code-dev` administrator credential in `whatsapp-sync`.
- Mount a rotated key for the existing private-sync service account itself.
- Grant that service account only the self-scoped
  [`roles/iam.serviceAccountOpenIdTokenCreator`](https://docs.cloud.google.com/iam/docs/service-account-permissions#service_account_openid_connect_identity_token_creator)
  role required to mint its OIDC token.
- Do not restore project-wide `roles/iam.serviceAccountTokenCreator`.
- Keep the current internal-auth and exact service-account edge checks.
- Add a focused Terraform/runtime test proving that the mounted identity equals the
  expected private-sync identity and that `generateIdToken` succeeds for the configured
  audience.

For independent recovery verification, provision one keyless
`wa-private-recovery-reader` service account. Grant it only
`roles/datastore.viewer` and bucket-level `roles/storage.objectViewer` restricted by IAM
condition to the private WhatsApp object prefix. Allow one explicitly reviewed human
operator to impersonate that reader with a service-account-level (never project-level)
Token Creator binding. The verification script must require human ADC plus impersonation,
the retained project, empty emulator variables, and this exact reader identity. It must
reject admin, runtime, file-backed, or ambient service-account credentials. This is an
operator read identity, not a new application component or endpoint.

### 2. Stop one media object from blocking all messages

Change the adapter's batch order:

1. map the Matrix events;
2. ingest message metadata through the existing private-events endpoint;
3. require every submitted event to be `accepted` or `duplicate`;
4. durably record media work in `/data/pending-media.json`;
5. save the Matrix cursor;
6. drain/retry pending media independently.

The pending-media file is deliberately small and local. Write it with mode 0600 through
an exclusive temporary file, fsync the file, atomically rename it, and fsync its parent
directory before the equally durable cursor write. Key entries by deterministic message
ID plus media kind, so a retry cannot create duplicates. A failed media upload sets
health to degraded and remains pending, but does not block later message metadata or
cursor progress.

Also fix the actual 502:

- make the media endpoint return/log a safe typed reason that distinguishes original GCS
  upload, Sharp thumbnail creation, and thumbnail GCS upload;
- reproduce the frozen object's failing branch without logging its URL, name, body,
  sender, room, or event ID;
- add a focused regression test and fix that branch;
- validate the fix with one controlled image upload before bulk backfill.

Do not treat a file larger than 25 MiB as this incident; that already has a separate
413/size path.

### 3. Process left rooms and refuse to skip a limited Matrix timeline

Build the processing plan from the union of `rooms.join` and `rooms.leave`; a normal
non-limited leave timeline can contain the final eligible messages and must be mapped,
ingested, and reflected in room context before the one cursor write.

Before saving `next_batch`, inspect both room buckets. A room is eligible when it is
already known in private state/data or its Matrix membership/state/invite proves it is a
WhatsApp bridge room. A limited room whose eligibility cannot be proved is fail-closed,
not a skip.

- If an eligible room has `timeline.limited: true`, do not advance the live cursor.
- Report `recovery_required` and the safe room/event counts in health. Return HTTP 503
  for `error`/`recovery_required`; return 200 only when the cursor may continue (including
  a clearly reported media-degraded state).
- Never log room IDs, event IDs, phone numbers, or message content.

Add tests for:

- a limited joined room;
- a limited left room;
- a non-limited left room containing a message;
- a room joined and left between two syncs;
- a limited room with an empty/non-WhatsApp visible tail but known-room or bridge-state
  proof;
- a normal non-limited batch that advances exactly once.

Add one mode-0600 maintenance fence on `/data`. The fixed adapter checks it before any
Matrix or API request and reports `recovery_required`. This is only a start guard, not a
second cursor or workflow engine.

### 4. Validate the ingest response body

HTTP 200 is not sufficient. For each submitted batch require:

- exactly one result per event;
- `accepted + duplicates == submitted`;
- `rejected == 0`;
- the returned deterministic result matches the submitted event.

Any mismatch blocks that cursor update and produces a safe error summary.

### 5. Add one idempotent backfill command

Create or extend:

```text
tools/whatsapp-private-matrix-sync/src/backfill-private-events.mjs
```

The command must reuse the live event mapper and existing private event/media endpoints.
It has three simple modes:

```text
discover -> apply -> finalize
```

- `discover` reads Matrix and writes a private manifest plus a sanitized summary.
- `apply` replays that manifest idempotently and can be rerun after interruption.
- `finalize` verifies results and atomically updates the existing state file.

There is no second cursor and no second mapping implementation.

## Backfill algorithm

### Freeze

1. Keep Synapse and mautrix-whatsapp running.
2. Stop only `whatsapp-sync`, disable its Docker restart policy, and create the maintenance
   fence. If the adapter has a dedicated supervisor, disable/mask it. If the existing
   supervisor also owns Synapse/mautrix, keep those core services running, point compose
   at the fixed image, and prove a forced adapter start exits `recovery_required` before
   any Matrix/API request. Keep the fence through `finalize` and prove no unit, timer, or
   restart policy can run an unfenced old adapter.
3. Copy `/data/state.json` to a protected mode-0600 backup and record its SHA-256 as
   `S0_STATE_HASH`. Never delete or initialize the live state file.
4. Build the fixed adapter image, but keep it stopped until the limited-timeline guard is
   present and the backup is verified.

### Discover

1. Read the raw `S0` token from the protected backup.
2. Call `/sync?since=S0&timeout=0` and retain its `next_batch` as `S1` inside the private
   manifest.
3. Use the union of joined, left, and invited rooms in that response and rooms already
   known to the private account. If an invite is an eligible WhatsApp room, join it while
   the live adapter is stopped, discard the candidate `S1`, and restart discovery from
   unchanged `S0`. Continue only when a complete discovery pass finds no unhandled
   eligible invite.
4. For every relevant room, paginate Matrix `/rooms/{roomId}/messages` forward from `S0`
   to `S1`. Follow every `end` token, including after an empty chunk, and stop on a token
   loop or no progress. Follow the token rules in the
   [Matrix Client-Server API](https://spec.matrix.org/v1.19/client-server-api/#get_matrixclientv3roomsroomidmessages).
5. Additionally paginate backward from `S0` until each room reaches a known Firestore
   event from before `2026-08-09T22:00:00.000Z`; for a room without such an anchor, scan
   to the beginning of visible history. Existing deterministic IDs make the overlap
   harmless and protect against the 17-minute difference between the last Firestore
   message and the frozen cursor.
6. De-duplicate globally by Matrix `event_id`, preserve Matrix order within each room,
   and classify every event as `mapped`, `policy_skip`, or `error`. Replay room
   name/topic/member state events in Matrix order to produce the `S2` room context even
   though those state events are not ingested as messages.

`policy_skip` is a closed, source-controlled allowlist of tested reasons: state-only
context events, exact known bridge-control event types, `m.notice`, and senders rejected
by the existing explicit non-WhatsApp predicate. Do not use a mapper `null` as a skip.
Any supported or unknown message-like event in an eligible room that lacks a valid event
ID, sender, timestamp, content, or relation target is a typed `error` and stops for agent
review. The sanitized summary reports counts per exact skip/error reason.

The manifest is private recovery data: mode 0600, outside Git, never attached to a PR.
The sanitized summary contains only counts by event type/reason and hashes of tokens and
IDs.

### Apply

1. Run the controlled image-media canary. If it fails, fix the concrete 502 branch,
   deploy that fix, and rerun discovery; do not waive the failure.
2. Submit mapped events oldest-to-newest per room, at most 100 per request, with
   `deliveryMode=backfill`.
3. Parse every response using the same validator as live sync.
4. Record pending media durably and drain it through the existing idempotent media
   endpoint.
5. On a timeout or crash, rerun the same manifest. Deterministic message IDs turn already
   committed events into duplicates.

### LLM-assisted exceptions

The backfill should stop, not guess, on an `error` classification, 403/404 Matrix access,
unresolved relation, encrypted attachment, repeated media failure, or inconsistent API
response.

For each stop it writes a sanitized exception record containing only:

- event type, message type, and relation/media category;
- room/event/target hashes;
- safe error code and stage;
- manifest position and retry count.

Give that record and the local source code to the SOL/HIGH agent. The agent may inspect
the corresponding private event locally, decide whether it needs a mapper bug fix, an
explicit safe skip, media retry, or a larger Matrix page, add one targeted test, deploy
if code changed, and resume the same manifest. Do not paste message bodies, phone
numbers, Matrix tokens, raw IDs, or credentials into an external prompt or logs.

If Matrix proves that historical media bytes are no longer available, preserve the
message metadata and close the pending item as an explicit reviewed
`media_unavailable` exception; do not fabricate an object or keep an infinite retry. List
that exception separately in the final report.

This is the intended place for LLM assistance. Do not build a permanent rule engine for
unknown one-off history before such an exception actually appears.

### Verify and catch up

After `S0 -> S1` succeeds:

1. Use the repository's
   [approved read-only Firestore procedure](../../.claude/reference/firestore-access.md)
   to check every expected deterministic message ID, the account message-count delta,
   and media status through the exact impersonated `wa-private-recovery-reader`. Never
   use an emulator or a runtime/admin credential for this verification.
2. Require all mapped IDs to exist, zero rejected events, and every expected media item
   to be `stored`, explicitly pending, or a reviewed terminal `media_unavailable` tied to
   that manifest position. Before finalization, pending must be empty; terminal exceptions
   remain separately reported.
3. While the adapter is still stopped, call `/sync?since=S1&timeout=0` to obtain `S2` and
   run the same discover/apply/verify logic for exactly `S1 -> S2`. An eligible invite in
   this catch-up must be joined and the catch-up repeated from unchanged `S1`; do not
   finalize across an unhandled invite.
4. Events after `S2` are intentionally left for the first live poll.

### Finalize and start

`finalize` is the only backfill mode allowed to write `/data/state.json`.

It must:

- compare the current live file byte-for-byte with the original `S0` backup;
- require successful verification of both segments and an empty pending-media queue;
- update `nextBatch` to `S2` and replayed room context while preserving unrelated state;
- write a mode-0600 temporary file, fsync it, atomically rename it, and fsync the parent
  directory;
- output only old/new state hashes, never cursor values.

Precompute the exact expected `S2` state bytes and hash. A retry accepts only two live
states: exact `S0` means perform the atomic write; exact expected `S2` means the earlier
write committed and `finalize` returns the same safe success. Any other state fails
closed. This is enough to recover from losing the process or response immediately after
the rename without adding a second cursor.

Then:

1. point the normal supervisor at the exact reviewed image, remove the maintenance and
   supervisor fences, and start the fixed adapter; assert the running image digest before
   accepting health;
2. require the cursor to advance beyond `S2` without 403, 5xx loops, rejected events, or
   `limited` gaps;
3. send one controlled text and one controlled image through WhatsApp and verify both in
   Firestore/GCS;
4. observe health for 30 minutes;
5. restart the adapter through its normal supervisor and verify that the same image comes
   back healthy.

If any live poll, including a later poll during observation, reports a limited timeline,
immediately recreate the maintenance fence, disable the adapter restart
policy/supervisor again, and prove it is stopped. Back up and hash the current last-safe
state as the next segment start (`S_next`, which may be later than `S2`) and use the same
backfill command from that token; never bypass the guard or restore an older state.

## Deployment order

1. Implement and test the IntexuraOS changes from current `origin/development` in an
   isolated checkout.
2. Open the implementation PR against `development`, require its checks, merge it, and
   record the exact merge SHA.
3. Deploy the API through the normal production workflow and prove
   `/deployment.json`/health identifies that SHA.
4. Update the separately managed Matrix host source from that exact merge, build the
   adapter image, and prove its source/image digest without starting it. Do not use the
   dirty personal clone.
5. Stop the old adapter, disable its restart policy, create the maintenance fence, freeze
   and verify `S0`, and leave it stopped. Disable an adapter-only supervisor; if the
   supervisor is shared with core Matrix, prove it can start only the fixed fenced image.
   This must happen before credential/IAM changes.
6. Apply the reviewed narrow IAM/secret change only after the freeze. Verify token minting
   with the fixed one-off image; never start the old live loop.
7. Run discovery, backfill, finalization, start, and verification as described above.
8. Record the exact host configuration in `pbuchman-dev` so the next restart cannot
   silently return to the old adapter.

## Tests and the minimal full-gate budget

During implementation run only focused tests for:

- Terraform identity/IAM configuration;
- Google ID-token generation and edge authorization;
- maintenance-fenced startup with zero Matrix/API calls and limited joined/left timelines;
- ingest response validation;
- pending-media persistence/retry and the reproduced 502 branch;
- invite joining/re-discovery, discover/apply retry, deterministic duplicates,
  two-segment catch-up, atomic finalize, and retry from the exact already-written `S2`
  state;
- a malformed supported/message-like event is `error`, never `policy_skip`, and every
  allowed skip reason has an exact predicate test.

Minimize full repository gates:

- Do **not** run `pnpm run ci:tracked` after every task.
- When all IntexuraOS edits are final and the latest `origin/development` is incorporated,
  run exactly one local `pnpm run ci:tracked` before the final commit.
- Push that exact commit and use the required PR workflow as the one remote full gate.
- Rerun the local full gate only if code/config changes afterward or the base changes.
- Apply the same rule to `pbuchman-dev`: focused checks while editing, one final local
  full gate, and its required PR gate.
- Deployment, Terraform apply, backfill, and read-only verification do not require another
  code gate when the tested tree is unchanged.

## Stop conditions

Do not advance the cursor or start live sync if any of these remains:

- IAM token generation fails;
- a Matrix pagination token loops or a limited gap is open;
- any mapped event is rejected or missing from Firestore;
- an exception has not been reviewed by the agent;
- an expected media item is neither stored, durably pending, nor an exact reviewed
  terminal `media_unavailable` manifest exception;
- pending media is non-empty at finalization;
- the running API or adapter SHA differs from the reviewed merge.

Never restore project-wide Token Creator, manually edit the cursor, delete partial
backfill writes, or start the old adapter against the new cursor.

## Definition of done

The implementation agent must deliver, in the same task:

- merged implementation changes and exact merge SHA(s);
- successful production API and Matrix-adapter deployment;
- proof that the production identity mints the expected token without broad IAM;
- successful deterministic `S0 -> S1 -> S2` backfill;
- counts of mapped/skipped/exceptions and accepted/duplicate/rejected results;
- Firestore/GCS verification with no missing expected data, no pending media, and any
  terminal `media_unavailable` exceptions listed separately;
- old/new cursor hashes;
- successful live text/image canaries, 30-minute observation, and supervised restart;
- a sanitized incident report with PR and deployment links.

Code or a green PR alone is not completion. Production synchronization and recovered
history must both be working.
