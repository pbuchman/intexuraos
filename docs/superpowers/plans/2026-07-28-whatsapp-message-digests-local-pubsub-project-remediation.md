# Message Digests — local Pub/Sub project remediation

**Status:** Completed on 2026-07-28. Both focused routing tests pass; the original reserved direct
run and its immutable delivery event were recovered once, and the subsequent group run completed
through the normal isolated-project subscriptions without a duplicate run.

## Outcome

Make the repository's existing local Pub/Sub forwarder consume `message-digest-runs` from the
same isolated emulator project used by `message-digest-service`. Keep established topics on the
existing default project, while additionally consuming `whatsapp-send-message` from the isolated
project because Message Digest uses the same local Pub/Sub client for its internal run and external
delivery outboxes. Resume the already-reserved browser acceptance run without creating a second
logical run or changing either frozen payload.

## Evidence and constraints

- The browser-created run was accepted once with HTTP `202` and remains truthfully `Queued`.
- `message-digest-service` uses `intexuraos-message-digest-mvp-local` for its local Firestore and
  Pub/Sub clients so MVP data cannot collide with another service or real development storage.
- `tools/pubsub-ui/server.mjs` currently creates every topic/subscription through one client whose
  project defaults to `demo-intexuraos`; therefore no subscription existed in the digest project at
  publish time.
- After the generation event was recovered, the run reached `Completed` and remained truthfully
  `Pending`: its frozen `whatsapp-send-message` event was also published in the isolated project,
  where the forwarder had no subscription. This confirms that the outbound topic must be listened
  to in both projects without rerouting established producers.
- Keep production configuration and all non-digest local topics unchanged. Do not broaden this into
  emulator lifecycle work or run full CI.
- Never print the retained user ID, definition ID, run ID, source metadata, prompt, message content,
  phone number, credentials, or frozen payload.

## TDD implementation

1. Add a focused pure contract test for Pub/Sub topic-to-project routing. Observe RED proving that
   `message-digest-runs` cannot yet resolve to the isolated project independently of other topics.
   Extend it with a second RED assertion proving that `whatsapp-send-message` needs both projects.
2. Add the smallest exported resolvers in `tools/pubsub-ui/pubsub-forwarding.mjs`:
   - established topics resolve to `PUBSUB_PROJECT_ID` / `demo-intexuraos`;
   - `message-digest-runs` resolves only to `MESSAGE_DIGEST_PUBSUB_PROJECT_ID` /
     `intexuraos-message-digest-mvp-local`;
   - `whatsapp-send-message` subscriptions resolve to the deduplicated ordered pair of the default
     and isolated projects, while manual publishing remains on the default project.
3. Update `tools/pubsub-ui/server.mjs` to cache one Pub/Sub client per resolved project and create
   topic monitoring subscriptions for every resolved topic/project binding. Use the singular
   default resolver for manual publish. Do not change endpoint/auth behavior.
4. Document the optional digest-project environment variable and the isolation reason.
5. Run the focused forwarding/script tests, ESLint/Prettier for touched files, and
   `git diff --check`; do not run `pnpm run ci:tracked`.

## Local acceptance recovery

1. Rebuild and restart only `pubsub-ui`; verify health and that the digest run plus outbound
   subscriptions are listening in the isolated emulator project before publishing anything.
2. Read the already-persisted run-request outbox from the isolated Firestore emulator without
   logging its fields, and forward its exact `payloadJson` once through the authenticated internal
   Pub/Sub envelope. This is recovery of the accepted run, not a new run.
3. Once generation is complete, read the same run's persisted WhatsApp-delivery outbox without
   logging its fields and forward its exact `payloadJson` once. In the already-open system Chrome,
   verify that the run advances from `Queued` through generation to truthful WhatsApp delivery
   status after a reload.
4. Continue the existing group/direct Chrome acceptance plan. No additional full CI run is allowed
   at this checkpoint.

## Completion gate

This remediation is complete only when the focused tests are green, the isolated subscription is
present, and the original browser-created run reaches a terminal state without a second run record.
