# Firestore monitoring cost implementation plan

> For agentic workers: use the subagent-driven-development workflow. The user delegated architecture choice and explicitly authorized PR merge and Home PROD deployment.

**Goal:** Remove recurring history scans from monitoring and verify at least 99% fewer monitoring document reads and document bytes in comparable live windows.

**Architecture:** Keep the current minute-level host probes. Services serve monitoring from change-driven state, recomputing deadlines at request time. Message Digest uses compact per-run monitoring projections written with source mutations; startup reads active definitions, unresolved work and bounded latest delivery/cursor evidence. Existing source history remains intact. Calendar and WhatsApp use bounded watches; heartbeat reads must also avoid per-probe reads.

**Tech stack:** TypeScript, Firestore Node SDK, Fastify, Vitest, existing Home PROD PM2 and GitHub deployment admission.

## Constraints and decisions

- No worktrees, history deletion, dropped alerts, weakened checks or new cloud services.
- During the first rollout, an absent/incomplete initialization marker temporarily retains legacy monitoring. Once initialized, missing/corrupt markers and listener failures fail closed; elapsed time must surface overdue work without writes.
- Listeners have startup/change/reconnect costs. They are not claimed free under all conditions. SDK does not support field masks with query listeners.
- A full-history cache or listener was rejected: restarts would still grow with all source history. Field masks alone retain paid document reads. Embedded unresolved arrays were rejected because of the Firestore document-size bound.
- Backfill only new compact monitoring records, using fresh transactional source reads to avoid replacing concurrent updates. Retain source records.
- Distinguish returned protobuf document bytes from network transport, scanned index bytes and billed transfer. Historical user-supplied billing ranges are not collection-specific exact cost.

## Work and ownership

- [x] Digest worker (`gpt-6.1-sol`, `xhigh`): app monitoring, transactional projection writes, external writer compatibility, backfill and required indexes. Tests cover silent/hidden/retired records, failed generation/delivery, delivered-through supersession, resume, missing generation, old unresolved work, startup/error/recovery and no idle reads.
- [x] Other monitoring worker (`gpt-6.1-sol`, `xhigh`): infra-firestore cache/heartbeat, Calendar and WhatsApp bounded monitoring. Tests cover time-only expiry, shutdown/error and overlapping heartbeat executions.
- [x] Measurement worker (`gpt-6.1-sol`, `high`): read-only baseline harness with aggregate document/read/byte output and no private payloads.
- [ ] Coordinator: inspect live exact release and timer; baseline measurements; review changes and writer completeness; run workspace verification and `pnpm run ci:tracked`; open and merge PR after required checks; deploy admitted exact development SHA through canonical workflow, then backfill after all live writers are upgraded; compare live idle and activity windows and record limitations.

## Verification gates

1. Functional regression tests and query-count tests must pass; large completed history must not increase normal monitoring reads.
2. Run `pnpm run verify:workspace:tracked <workspace>` for every changed workspace and `pnpm run ci:tracked` before commit/PR.
3. Require successful CI on exact merged development SHA, then dispatch Deploy target home-prod. Verify active release, app/edge/collector health and host monitoring snapshot.
4. Record before/after metrics including initialization separately. Exercise delivery/failure semantics without sending unsolicited messages or damaging actual user records. Distinguish controlled synthetic proofs from observed actual deliveries.
5. Report code, merge, deployment and verified live effect separately. Do not claim full objective from tests or extrapolated billing alone.
