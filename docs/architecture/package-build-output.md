# Package Build Output Policy

## Source Exports Only

Every workspace package under `packages/*` exports TypeScript source directly:

```jsonc
{
  "exports": {
    ".": "./src/index.ts"
  }
}
```

There is no package-level runtime build output. Package `tsconfig.json` files use
`noEmit: true`, their `exports` maps must not reference `./dist/`, and package
`dist/` directories are treated as transient cleanup targets.

## Why This Works

- Node 22 is the minimum runtime, and repo tooling reads TypeScript source in
  tests and scripts.
- Deployable services are bundled per app by `scripts/build-service.mjs`.
- Workspace packages are private and have no external published artifact
  contract.

## Enforcement

`scripts/verify-package-exports.mjs` enforces this policy in CI:

1. every package has a README and matching `docs/packages/<pkg>/README.md`;
2. package exports do not reference `./dist/`;
3. package `tsconfig.json` files do not enable emit output.
