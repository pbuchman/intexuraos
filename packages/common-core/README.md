# @intexuraos/common-core

Result/Either types, error base classes, and redaction utilities. Leaf package shared by every other workspace package and app.

## Contract

- **Layer:** leaf
- **Dependencies:** None (leaf)
- **Exports:** `./src/index.ts`, `./src/codeTaskWorkerTypes.ts`, `./src/errors.ts` (source-exports — no `dist/` emission)

## Usage

```ts
import { ok, err, type Result } from '@intexuraos/common-core';
import { AppError } from '@intexuraos/common-core/errors';
```

For full API documentation, see [`docs/packages/common-core/README.md`](../../docs/packages/common-core/README.md).

## Tests

```bash
pnpm vitest run packages/common-core
```
