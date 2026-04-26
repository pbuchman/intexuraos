# @intexuraos/infra-otel

OpenTelemetry SDK bootstrap for Dash0 trace/metric export. **Single exception** to the source-exports build policy: emits `dist/register.js` so it can be loaded via `node --require` at process bootstrap, before any TS loader is registered.

## Contract

- **Layer:** infra-wrapper (bootstrap)
- **Dependencies:** None (leaf, OTel SDK only)
- **Exports:**
  - `.` → `./src/index.ts` (source-exports)
  - `./register` → `./dist/register.js` (compiled — required by `node --require`)

See [`docs/architecture/package-build-output.md`](../../docs/architecture/package-build-output.md) for why this is the only package that ships compiled JS.

## Usage

```bash
node --require @intexuraos/infra-otel/register dist/index.js
```

```ts
import { initOtel } from '@intexuraos/infra-otel';
```

For full API documentation, see [`docs/packages/infra-otel/README.md`](../../docs/packages/infra-otel/README.md).

## Tests

```bash
pnpm vitest run packages/infra-otel
```
