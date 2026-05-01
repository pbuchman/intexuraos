# @intexuraos/common-worker

Frozen API contract for IntexuraOS Cloud Functions / Pub/Sub workers. Provides
a single import surface for logger creation, env validation, internal-auth
verification, and the unified ack/nack/dead-letter wrapper that bracket every
Pub/Sub-triggered worker.

**Node:** >=22.0.0
**Type:** ESM
**Layer:** infra (depends on `@intexuraos/common-core`, `@intexuraos/infra-pubsub`, `@intexuraos/infra-sentry`)
**Frozen contract reference:** `docs/plans/2026-04-24-workers-layer-refactor.md` §3.3

## Exports

| Entry Point | Path                      | Contents                                                                                          |
| ----------- | ------------------------- | ------------------------------------------------------------------------------------------------- |
| Main        | `.` (index)               | `createWorkerLogger`, `loadRequiredEnv`, `verifyInternalAuth`, `withObservability`, `AckDecision` |
| Testing     | `./testing` (sub-export)  | `createFakeLogger`, `makePubSubCloudEvent`, `makeHttpRequest`, `makeHttpResponse`                 |

## API Reference

### `createWorkerLogger(name)` — `logger.ts`

Pino wrapper with `{ worker: name }` base bindings and the shared
`serializeError` serializer for `error` / `err` keys. Reads `LOG_LEVEL` once
(defaults to `info`; empty string treated as unset).

```ts
const logger = createWorkerLogger('transcription');
logger.info({ traceId }, 'starting');
const child = logger.child({ requestId: 'abc' });
```

### `loadRequiredEnv(spec)` — `env.ts`

Fail-fast environment-variable loader. Throws at module load with EVERY missing
required var listed in a single error so misconfiguration surfaces in one
deploy attempt, not three. Empty string is treated as missing — partially
templated env files are the most common silent failure mode this guards
against.

```ts
const env = loadRequiredEnv({
  INTEXURAOS_GCP_PROJECT_ID: { required: true },
  LOG_LEVEL: { required: false, default: 'info' },
  OPTIONAL_FEATURE_FLAG: { required: false }, // defaults to ''
});
// env.INTEXURAOS_GCP_PROJECT_ID is `string`, not `string | undefined`
```

### `verifyInternalAuth(headerValue, expectedToken)` — `auth.ts`

Constant-time check of `X-Internal-Auth` against the configured shared secret.

- Raw token only — `Bearer <token>` is rejected (the legacy `vm-lifecycle`
  bug fixed by INT-1530).
- `expectedToken` undefined / empty → `false`. A config bug must NOT degrade
  into "everyone is authenticated".
- `headerValue` may be `string | string[] | undefined`; arrays use the first
  element.
- Length mismatch → `false` without invoking `timingSafeEqual` (which throws
  on unequal lengths).

### `withObservability(name, handler, opts?)` — `observability.ts`

Wraps a `CloudEventHandler<D>` with the unified ack/nack/dead-letter
contract.

```ts
type AckDecision = 'ack' | 'nack' | 'dlq';

interface AckResult {
  readonly decision: AckDecision;
  readonly reason?: string;
}

interface ObservabilityOptions {
  readonly sentryDsn?: string;
  readonly dlqPublish?: (payload: unknown, reason: string) => Promise<void>;
  readonly logger?: WorkerLogger; // test seam; production omits
}
```

Decision semantics:

| Return value                | Behaviour                                                              |
| --------------------------- | ---------------------------------------------------------------------- |
| `Ack`                       | Resolve. Pub/Sub ACKs.                                                 |
| `Nack`                      | Throw. Pub/Sub redelivers per subscription retry policy.               |
| `DeadLetter` + `dlqPublish` | Publish payload + reason to DLQ, resolve.                              |
| `DeadLetter` w/o publisher  | Degrade to Nack with WARN log — never silently ACK.                    |
| Handler throws              | Capture to Sentry (if DSN), re-throw → Pub/Sub redelivers.             |

A `worker_request_start` log line is emitted on entry; `worker_request_ack` /
`worker_request_nack` / `worker_request_dlq` / `worker_request_error` brackets
each invocation for trace-id correlation.

## Testing helpers (`./testing` sub-export)

```ts
import {
  createFakeLogger,
  makePubSubCloudEvent,
  makeHttpRequest,
  makeHttpResponse,
} from '@intexuraos/common-worker/testing';

const log = createFakeLogger();
const event = makePubSubCloudEvent({ foo: 'bar' });
expect(log.entries).toHaveLength(1);
```

The runtime barrel does NOT re-export these — production builds never ship
test fakes.

## Local development

```bash
pnpm --filter @intexuraos/common-worker test
pnpm --filter @intexuraos/common-worker test:coverage
pnpm --filter @intexuraos/common-worker typecheck
pnpm --filter @intexuraos/common-worker lint:local
```

Branch / line / function / statement coverage are all enforced at 100% for
this package — every contract path has a test.
