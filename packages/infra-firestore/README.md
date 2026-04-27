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

For full API documentation, see [`docs/packages/infra-firestore/README.md`](../../docs/packages/infra-firestore/README.md).

## Tests

```bash
pnpm vitest run packages/infra-firestore
```
