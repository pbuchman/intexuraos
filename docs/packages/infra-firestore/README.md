# @intexuraos/infra-firestore

Firestore database client singleton and in-memory testing fake. Provides the shared Firestore instance used by all IntexuraOS services.

## What It Wraps

- **External API:** Google Cloud Firestore via `@google-cloud/firestore` (v7.10+)
- **Pattern:** Singleton with test injection support

## API Reference

### `getFirestore(): Firestore`

Returns the Firestore client singleton. Creates a new instance on first call using `INTEXURAOS_GCP_PROJECT_ID`. Connects to real GCP Firestore in all environments.

```ts
import { getFirestore } from '@intexuraos/infra-firestore';

const db = getFirestore();
const doc = await db.collection('users').doc('user-123').get();
```

Throws `Error` if `INTEXURAOS_GCP_PROJECT_ID` is not set.

### `setFirestore(instance: Firestore): void`

Overrides the singleton with a custom Firestore instance. Used in tests to inject the fake.

```ts
import { setFirestore, resetFirestore, createFakeFirestore } from '@intexuraos/infra-firestore';
import type { Firestore } from '@intexuraos/infra-firestore';

beforeEach(() => {
  const fake = createFakeFirestore();
  setFirestore(fake as unknown as Firestore);
});

afterEach(() => {
  resetFirestore();
});
```

### `resetFirestore(): void`

Resets the singleton to `null`, forcing a new instance on the next `getFirestore()` call.

### `FieldValue`

Re-export of `@google-cloud/firestore` `FieldValue` for use in repositories (e.g., `FieldValue.delete()`, `FieldValue.arrayUnion()`).

### `createFakeFirestore(): FakeFirestore`

Creates an in-memory Firestore implementation for unit testing. Supports:

- **Collections and documents:** `collection()`, `doc()`, `add()`, `set()`, `get()`, `update()`, `delete()`
- **Queries:** `where()`, `orderBy()`, `limit()`, `startAfter()` with chainable API
- **Query operators:** `==`, `!=`, `<`, `<=`, `>`, `>=`, `array-contains`, `in`
- **FieldValue sentinels:** `FieldValue.delete()`, `FieldValue.arrayUnion()`
- **Dot-notation paths:** Nested field access/update (e.g., `'llmApiKeys.google'`)
- **Subcollections:** Via `doc().collection()` with composite path keys
- **Batch writes:** `batch()` with `set()`, `update()`, `delete()`, `commit()`
- **Transactions:** `runTransaction()` with serialized execution and isolated reads/writes
- **Test utilities:** `seedCollection()`, `getAllData()`, `clear()`, `configure({ errorToThrow })`

## Exported Types

| Type                  | Description                                             |
| --------------------- | ------------------------------------------------------- |
| `Firestore`           | Re-export of `@google-cloud/firestore` `Firestore`      |
| `FakeFirestore`       | Type alias for the in-memory Firestore implementation   |
| `FakeFirestoreConfig` | Configuration for fake behavior (e.g., error injection) |

### FakeFirestoreConfig

```ts
interface FakeFirestoreConfig {
  errorToThrow?: Error; // If set, all operations throw this error
}
```

## Configuration

### Environment Variables

| Variable                    | Description             | Required |
| --------------------------- | ----------------------- | -------- |
| `INTEXURAOS_GCP_PROJECT_ID` | Google Cloud project ID | Yes      |

## Error Handling

`getFirestore()` throws a synchronous `Error` if `INTEXURAOS_GCP_PROJECT_ID` is undefined. All Firestore operations propagate standard `@google-cloud/firestore` errors.

The fake implementation throws `Error` when:

- `update()` or transaction `update()` targets a nonexistent document
- `configure({ errorToThrow })` injects a specific error

## Used By

This is the most widely used infrastructure package. Consumed by virtually every app and several packages:

**Apps:** `actions-agent`, `app-settings-service`, `bookmarks-agent`, `calendar-agent`, `chat-agent`, `code-agent`, `commands-agent`, `data-insights-agent`, `image-service`, `linear-agent`, `mobile-notifications-service`, `notes-agent`, `notion-service`, `research-agent`, `todos-agent`, `user-service`, `whatsapp-service`

**Packages:** `http-server`, `llm-audit`, `llm-pricing`

## Recent Changes

| Commit      | Description                                                 | When        |
| ----------- | ----------------------------------------------------------- | ----------- |
| `c4e3a13c`  | Release v3.3.0                                              | 2 hours ago |
| `293426524` | feat(llm): add tool calling infrastructure for GitHub Agent | 7 days ago  |
| `44ea683ae` | Release v3.2.0                                              | 8 days ago  |
| `b3f34d857` | Release v3.1.0                                              | 3 weeks ago |
| `c8a421050` | Release v3.0.0                                              | 3 weeks ago |
