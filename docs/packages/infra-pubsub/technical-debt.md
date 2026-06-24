# @intexuraos/infra-pubsub - Technical Debt

## Code Quality

The package follows a clean pattern: abstract base class with concrete publisher implementations. Each publisher exposes an interface for testability and a factory function for creation. Test coverage is strong with recent efforts to close branch coverage gaps.

### Current Issues

#### 1. Topic cache grows unbounded

`BasePubSubPublisher` caches topic references in a `Map<string, Topic>` with no eviction. Since each publisher typically uses a single topic, this is not a problem in practice, but the pattern does not prevent accumulation if a publisher is created with many different topic names.

**Impact:** None in practice. Each publisher instance uses one topic.

#### 2. Error classification uses string matching

The `mapError` method in `BasePubSubPublisher` classifies errors by checking if the error message includes `'NOT_FOUND'` or `'PERMISSION_DENIED'`. This is fragile and depends on the `@google-cloud/pubsub` library's error message format remaining stable.

**Impact:** Low. Error classification is informational (for logging). The publish still fails correctly regardless of classification.
**Suggested fix:** Check error codes from the gRPC status instead of parsing message strings. The `@google-cloud/pubsub` library wraps gRPC errors with status codes.

#### 3. Logger type uses pino directly instead of common-core Logger

The publisher configs and `BasePubSubPublisher` accept `Logger` from `pino` rather than the `Logger` interface from `@intexuraos/common-core`. This creates a tighter coupling to pino and means test mocks must match pino's broader interface rather than the minimal 4-method contract.

**Impact:** Low. All services use pino, so the type is always satisfied.
**Suggested fix:** Accept `Logger` from `@intexuraos/common-core` instead. The common-core `Logger` interface is a subset of pino's, so existing code would still compile.

#### 4. Duplicated config interfaces

`WhatsAppSendPublisherConfig` and `CalendarPreviewPublisherConfig` are identical (`{ projectId, topicName, logger }`). Each is defined separately in `types.ts`.

**Impact:** Low. The types are stable and the duplication is minimal.
**Suggested fix:** Consider a generic `PublisherConfig` type: `BasePubSubPublisherConfig & { topicName: string }`.

#### 5. correlationId auto-generation uses crypto.randomUUID

Each publisher falls back to `crypto.randomUUID()` when no `correlationId` is provided. This works but means the caller loses traceability if they forget to pass the correlation ID from the incoming request context.

**Impact:** Medium. Missing correlation IDs break end-to-end tracing.
**Suggested fix:** Make `correlationId` a required parameter to force callers to propagate trace context.

## Future Plans

- Add a dead letter topic configuration for failed publishes
- Consider adding message ordering key support for publishers that need ordered delivery
- Evaluate adding batch publishing support for high-throughput scenarios
- Consider migrating from class-based to function-based publishers for consistency with the rest of the codebase
