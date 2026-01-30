# Naming Conventions

## Linear Issue Titles

### Format

```
[coverage][<target>] <filename> <description>
```

### Components

| Component | Description | Example |
|-----------|-------------|---------|
| `[coverage]` | Fixed prefix for all coverage issues | `[coverage]` |
| `[<target>]` | App or package name | `[actions-agent]`, `[infra-claude]` |
| `<filename>` | Source file name (without path) | `client.ts`, `researchRoutes.ts` |
| `<description>` | Brief description of gaps | `error handling branches` |

### Examples

```
[coverage][actions-agent] executeAction.ts error handling branches
[coverage][actions-agent] actionRoutes.ts authentication guards
[coverage][research-agent] researchRoutes.ts optional parameter checks
[coverage][infra-perplexity] client.ts timeout callback
[coverage][infra-claude] client.ts retry logic edge cases
[coverage][common-core] result.ts type narrowing fallbacks
```

### Search Patterns

To find existing issues:
```
# All coverage issues
title contains "[coverage]"

# Coverage issues for specific target
title contains "[coverage][actions-agent]"

# Coverage issues for specific file
title contains "[coverage][actions-agent] client.ts"
```

---

## v8 Ignore Comments

### Format

```
/* v8 ignore <CATEGORY> -- <explanation> */
```

### Components

| Component | Description | Example |
|-----------|-------------|---------|
| `v8 ignore` | Fixed prefix | `v8 ignore` |
| `<CATEGORY>` | Valid category ID | `ts-type`, `regex`, `module-init`, etc. |
| `--` | Separator between category and explanation | `--` |
| `<explanation>` | Brief reason why branch is unreachable | `length check guarantees element exists` |

### Valid Categories

| Category | Description |
|----------|-------------|
| `ts-type` | TypeScript type narrowing guarantees branch unreachable |
| `regex` | Capture group guaranteed by regex pattern |
| `module-init` | Module-level code runs before tests |
| `async-timing` | Callback cancelled before it fires in tests |
| `test-infra` | Fake/mock cannot produce required state |
| `upstream` | Prior check makes downstream redundant |
| `module-mock` | SDK property getters not mockable |
| `schema` | Schema validation makes fallback unreachable |
| `source-map` | Tests cover but v8 doesn't detect |
| `auth-guard` | Auth failure paths tested at middleware level |

### Example Comments

```typescript
/* v8 ignore ts-type -- length check guarantees element exists */
const first = items[0] ?? fallback;

/* v8 ignore regex -- .+ pattern guarantees group 1 captures */
const title = match[1] ?? '';

/* v8 ignore test-infra -- FakeAuthPlugin always succeeds */
if (user === null) { return reply.fail('UNAUTHORIZED'); }
```

### Validation

Run `pnpm run verify:v8-ignore` to validate all inline comments.
