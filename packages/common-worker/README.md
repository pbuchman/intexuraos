# @intexuraos/common-worker

Frozen API contract for IntexuraOS Cloud Functions / Pub/Sub workers — logger,
env loader, internal-auth check, and the `withObservability` ack/nack/DLQ
wrapper. Subtask A of [INT-1530](https://linear.app/pbuchman/issue/INT-1530).

## Contract

- **Layer:** infra (depends on `common-core`, `infra-pubsub`, `infra-sentry`)
- **Exports:** `./src/index.ts` (runtime), `./src/testing/index.ts` (test helpers — `createFakeLogger`, `makePubSubCloudEvent`, `makeHttpRequest`, `makeHttpResponse`)
- **Frozen API:** `docs/plans/2026-04-24-workers-layer-refactor.md` §3.3 — every worker subtask (B–D) codes against the symbols re-exported here.

## Usage

```ts
import {
  AckDecision,
  createWorkerLogger,
  loadRequiredEnv,
  verifyInternalAuth,
  withObservability,
} from '@intexuraos/common-worker';

const env = loadRequiredEnv({
  INTEXURAOS_GCP_PROJECT_ID: { required: true },
  LOG_LEVEL: { required: false, default: 'info' },
});

const logger = createWorkerLogger('my-worker');

export const handler = withObservability('my-worker', async (event, log) => {
  log.info({ eventId: event.id }, 'processing');
  return { decision: AckDecision.Ack };
});
```

For full API documentation, see [`docs/packages/common-worker/README.md`](../../docs/packages/common-worker/README.md).

## Tests

```bash
pnpm --filter @intexuraos/common-worker test
pnpm --filter @intexuraos/common-worker test:coverage
```
