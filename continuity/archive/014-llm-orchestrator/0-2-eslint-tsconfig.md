# Task 0-2: Update Root tsconfig and ESLint Config

## Objective

Add research-agent-service to root configuration files.

## Files to Modify

### 1. tsconfig.json (root)

Add reference:

```json
{ "path": "apps/research-agent-service" }
```

### 2. eslint.config.js

Add to `boundaries/elements`:

```javascript
{ type: 'research-agent', pattern: ['apps/research-agent-service/src/**'], mode: 'folder' }
```

Add to `boundaries/element-types` rules:

```javascript
{
  from: 'research-agent',
  allow: [
    'research-agent',
    'common-core',
    'common-http',
    'infra-firestore',
    // infra packages will be added in Tier 1
  ]
}
```

Add to `no-restricted-imports` patterns:

```javascript
{
  group: ['@intexuraos/research-agent-service', '@intexuraos/research-agent-service/**'],
  message: 'Cross-app imports are forbidden. Apps cannot import from other apps.',
}
```

## Verification

```bash
npm run lint
npm run typecheck
```

## Acceptance Criteria

- [ ] Root tsconfig.json includes research-agent-service
- [ ] ESLint boundaries configured
- [ ] ESLint no-restricted-imports updated
- [ ] `npm run lint` passes
- [ ] `npm run typecheck` passes
