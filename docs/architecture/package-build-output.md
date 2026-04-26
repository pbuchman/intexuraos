# Package Build Output Policy

## Default: source-exports (no `dist/` emission)

Every workspace package under `packages/*` exports TypeScript source directly:

```jsonc
// packages/<name>/package.json
{
  "exports": {
    ".": "./src/index.ts"
  }
}
```

There is **no `tsc` build step** for these packages. Each package's `tsconfig.json` uses `noEmit: true`. Their `dist/` directories must not exist on disk and must not be referenced from any `exports` map.

### Why this works

- **Node 22** is the minimum runtime. Combined with `tsx` (CLI / scripts) and `vitest` (tests), the workspace tooling natively reads `.ts` files at import time. There is no need to ship compiled JS to consumers inside the monorepo.
- **Cloud Run apps** are bundled per-app by `esbuild` (see `scripts/build-service.mjs`). The bundler resolves workspace imports through the package's `exports` field — pointing it at `./src/index.ts` is what we want, because the bundler then sees the full TypeScript AST and tree-shakes against it. Pointing it at a pre-compiled `./dist/index.js` would make tree-shaking strictly worse and add a build step the bundler does not need.
- **No external consumers.** Every workspace package is `private: true`. There is no published artifact contract to preserve.

### Operational consequences

- `pnpm -r build` is effectively a no-op for workspace packages. Per-app esbuild bundling is the only build that produces deployable artifacts.
- `pnpm -r typecheck` is the source of TS validation for packages.
- Adding `outDir`/`declaration` to a package `tsconfig.json` is forbidden — it would produce orphan `dist/` directories that are never consumed.

## The single exception: `@intexuraos/infra-otel`

`@intexuraos/infra-otel` ships a `./register` entry pointing at compiled JS:

```jsonc
// packages/infra-otel/package.json
{
  "exports": {
    ".": "./src/index.ts",
    "./register": "./dist/register.js"
  }
}
```

### Why this exception is necessary

OpenTelemetry auto-instrumentation hooks Node's module loader and the network stack at process bootstrap, **before** application code (and any TS loader) is evaluated. The canonical way to load it is:

```bash
node --require @intexuraos/infra-otel/register dist/index.js
```

`node --require` only accepts plain JavaScript — it cannot call into `tsx` or any TS transformer because those transformers are themselves loaded by the very mechanism OTel must instrument first. The `./register` entry must therefore be plain compiled JS, produced by a real `tsc -p tsconfig.build.json` step.

The `infra-otel` package keeps its main `.` export at `./src/index.ts` so library consumers (apps importing `initOtel` etc.) still get source-exports semantics. Only the `./register` path is compiled.

## Enforcement

`scripts/verify-package-exports.mjs` (wired into `pnpm run ci:tracked` under the `Static Validation` phase) enforces this policy on every CI run:

1. Recursively flattens every `packages/*/package.json` `exports` field.
2. Fails if any string value contains `./dist/`, **except** for `@intexuraos/infra-otel`.
3. Fails if any package directory is missing a `README.md`.

To intentionally add a second exception, both the script's allowlist and this document must be updated together.
