# @intexuraos/infra-firestore

Firestore client singleton and an in-memory fake implementation for unit tests.

## Contract

- **Layer:** infra-wrapper
- **Dependencies:** `@intexuraos/common-core`
- **Exports:** `./src/index.ts` (source-exports — no `dist/` emission)

## Usage

```ts
import { getFirestore, FakeFirestore } from '@intexuraos/infra-firestore';
```

Persist scheduled execution in a service-owned collection declared in
`firestore-collections.json`:

```ts
import { createJobHeartbeatStore } from '@intexuraos/infra-firestore';

const heartbeats = createJobHeartbeatStore({ collectionName: 'example_job_heartbeats' });
const run = await heartbeats.start('known_scheduler_key');
let outcome: 'succeeded' | 'failed' = 'failed';
try {
  await runScheduledWork(); // A successful no-work tick also counts as success.
  outcome = 'succeeded';
} finally {
  await heartbeats.finish(run, outcome);
}
const jobs = await heartbeats.list(['known_scheduler_key']);
```

Transactions preserve monotonic timestamps and keep an older overlapping run
from replacing the newest run's outcome. Failed runs retain the previous success
timestamp. Storage failures propagate to callers. The public records contain
only job keys, timestamps and outcomes; execution tokens remain private.

Home PROD explicitly sets `INTEXURAOS_MONITORING_STATE_DIR` to a stable directory
outside code releases. In that runtime, heartbeats use atomic, fsynced local JSON
instead of Firestore transactions. A parent-held kernel `flock` enforces one
process owner per service collection. Acquiring that lock uses Python 3's
standard-library `fcntl.flock` on the inherited descriptor, so local persistence
and its tests require `python3` on Linux and macOS. An absent local file imports the small
existing Firestore heartbeat collection once; corrupt files and I/O failures
fail closed. Restarting with an existing file needs no database reads. This
backend relies on the single-host, one-fork-per-app production contract.

`createFirestoreSnapshotCache` provides lazy process-lifetime query watches for
monitoring. Repeated `read()` calls do not issue queries. Repositories evaluate
time-based deadlines and expiry on every request; moving query windows rebase
only after received data changes, so idle data causes no periodic rereads.
Initial readiness is bounded, terminal errors retry with backoff, and the pinned
Firestore SDK transport observer detects transient disconnects and stalled
streams without additional requests. Streams must catch up at an untargeted
`NO_CHANGE` read-time barrier before cached data becomes available again.

Monitoring diagnostics expose aggregate received-document counts, canonical
Document protobuf bytes, and complete ListenResponse protobuf bytes (including
idle keepalives). They exclude transport/TLS framing and billing minimums; they
are not a billed-read counter. One-time local heartbeat bootstrap is included.
Close both the heartbeat store and `closeFirestoreSnapshotCaches()` on service
shutdown. The transport observer is guarded to Firestore SDK 7.11.6 and must be
reverified when upgrading that dependency.

For full API documentation, see [`docs/packages/infra-firestore/README.md`](../../docs/packages/infra-firestore/README.md).

## Tests

```bash
pnpm vitest run packages/infra-firestore
```
