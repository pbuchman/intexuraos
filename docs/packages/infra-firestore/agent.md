# Agent Reference: @intexuraos/infra-firestore

## Identity

| Attribute | Value                                                      |
| --------- | ---------------------------------------------------------- |
| Package   | `@intexuraos/infra-firestore`                              |
| Version   | 3.3.0                                                      |
| Purpose   | Firestore client singleton and in-memory testing fake      |
| SDK       | `@google-cloud/firestore` ^7.10.0                          |

## Exports

```ts
// Singleton management
export function getFirestore(): Firestore;
export function resetFirestore(): void;
export function setFirestore(instance: Firestore): void;

// Re-exports
export { FieldValue };
export type { Firestore };

// Testing
export function createFakeFirestore(): FakeFirestore;
export type { FakeFirestore, FakeFirestoreConfig };
```

## Key Interfaces

```ts
// Firestore = @google-cloud/firestore Firestore class

interface FakeFirestoreConfig {
  errorToThrow?: Error;
}

// FakeFirestore provides:
// .collection(name) => FakeCollectionReference
// .batch() => FakeBatch           — NOT truly atomic; operations execute sequentially on commit()
// .runTransaction(fn) => Promise<T>  — serialized via queue; reads/writes isolated until commit
// .seedCollection(name, docs) => void
// .getAllData() => Map<string, Map<string, DocumentData>>
// .clear() => void               — also resets transaction queue
// .configure(config) => void
// .listCollections() => Promise<CollectionReference[]>
```

## Usage Patterns

### Production: get Firestore instance

```ts
import { getFirestore } from '@intexuraos/infra-firestore';

const db = getFirestore();
const doc = await db.collection('users').doc(userId).get();
```

### Testing: inject fake Firestore

```ts
import { createFakeFirestore, setFirestore, resetFirestore } from '@intexuraos/infra-firestore';
import type { Firestore } from '@intexuraos/infra-firestore';

let fakeDb: FakeFirestore;

beforeEach(() => {
  fakeDb = createFakeFirestore();
  setFirestore(fakeDb as unknown as Firestore);
});

afterEach(() => {
  resetFirestore();
});
```

### Testing: seed data

```ts
fakeDb.seedCollection('users', [
  { id: 'user-1', data: { name: 'Alice', email: 'alice@example.com' } },
  { id: 'user-2', data: { name: 'Bob', email: 'bob@example.com' } },
]);
```

### Testing: simulate errors

```ts
fakeDb.configure({ errorToThrow: new Error('Firestore unavailable') });
```

## Dependencies

- `@intexuraos/common-core` — Result types

## Environment Variables

- `INTEXURAOS_GCP_PROJECT_ID` (required)

## FakeFirestore Capabilities

| Feature                   | Supported |
| ------------------------- | --------- |
| CRUD operations           | Yes       |
| `where()` queries         | Yes       |
| `orderBy` / `limit`       | Yes       |
| `startAfter`              | Yes       |
| Subcollections            | Yes       |
| Batch writes              | Yes       |
| Transactions              | Yes       |
| `FieldValue.delete()`     | Yes       |
| `FieldValue.arrayUnion()` | Yes       |
| Dot-notation paths        | Yes       |
| `collectionGroup()`       | No        |
| `onSnapshot()`            | No        |

## Constraints

**Do NOT:**

- Use `where()` with dot-notation field paths — the fake evaluates filters using direct property lookup, not `getNestedField()`
- Rely on string-based `orderBy` sorting — the fake defaults to numeric comparison
- Rely on batch atomicity semantics — `FakeBatch.commit()` executes operations sequentially; failures do not roll back

**Requires:**

- `INTEXURAOS_GCP_PROJECT_ID` environment variable for production use
- Call `fakeDb.clear()` in `afterEach` to avoid test-to-test state leakage via the transaction queue
