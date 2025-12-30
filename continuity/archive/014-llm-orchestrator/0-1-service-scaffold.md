# Task 0-1: Create llm-orchestrator-service Scaffold

## Objective

Create the basic structure for llm-orchestrator-service app.

## Structure

```
apps/llm-orchestrator-service/
├── package.json
├── tsconfig.json
├── Dockerfile
└── src/
    ├── domain/
    │   └── research/
    │       ├── models/
    │       ├── ports/
    │       └── usecases/
    ├── infra/
    ├── routes/
    ├── server.ts
    └── services.ts
```

## Files to Create

### package.json

```json
{
  "name": "@intexuraos/llm-orchestrator-service",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "build": "tsc -b",
    "dev": "tsx watch src/server.ts",
    "start": "node dist/server.js"
  },
  "dependencies": {
    "@intexuraos/common-core": "*",
    "@intexuraos/http-contracts": "*",
    "@intexuraos/http-server": "*",
    "@intexuraos/infra-firestore": "*",
    "fastify": "^4.x"
  }
}
```

### tsconfig.json

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "composite": true,
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "src/__tests__"],
  "references": [
    { "path": "../../packages/common-core" },
    { "path": "../../packages/http-contracts" },
    { "path": "../../packages/http-server" },
    { "path": "../../packages/infra-firestore" }
  ]
}
```

## Verification

```bash
npm install
npm run typecheck
```

## Acceptance Criteria

- [ ] Directory structure created
- [ ] package.json with correct dependencies
- [ ] tsconfig.json with correct references
- [ ] Basic server.ts placeholder
- [ ] `npm run typecheck` passes
