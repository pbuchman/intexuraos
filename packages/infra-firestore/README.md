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

For full API documentation, see [`docs/packages/infra-firestore/README.md`](../../docs/packages/infra-firestore/README.md).

## Tests

```bash
pnpm vitest run packages/infra-firestore
```
