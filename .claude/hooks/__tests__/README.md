# Claude Hooks Test Framework

Comprehensive test framework for 22 Claude hooks in `.claude/hooks/`.

## Overview

This framework uses **Node.js + Vitest** to execute bash hooks with mocked inputs and validate:

- Exit codes (0 = allow, 2 = block)
- stderr messages (BLOCKED/WARNED patterns)
- Log file outputs (`hooks.log`)

## Why Node.js Instead of bats-core?

| Factor              | bats-core       | Node.js + Vitest               |
| ------------------- | --------------- | ------------------------------ |
| CI Integration      | Separate binary | Already in `pnpm test`         |
| JSON Input Handling | Requires jq     | Native `JSON.parse()`          |
| Exit Code Testing   | Manual          | Built-in assertions            |
| Speed               | Fork overhead   | In-process                     |
| Parallel Execution  | Limited         | Built-in `describe.concurrent` |

## Directory Structure

```
.claude/hooks/__tests__/
├── fixtures/                    # Mock input files
│   ├── bash/                    # Bash tool inputs
│   ├── edit/                    # Edit tool inputs
│   ├── transcripts/             # Sample transcripts
│   └── temp-files/              # Temporary test files
├── helpers/                     # Test utilities
│   ├── executeHook.ts           # Core: execute hook with mock input
│   ├── assertions.ts            # Custom assertions (expectBlocked, expectWarned)
│   ├── fixtures.ts              # Fixture builder for hook inputs
│   └── tempDir.ts               # Temp directory management
├── validation.test.ts           # Tests for 11 VALIDATION hooks
├── detection.test.ts            # Tests for detect-common-patterns.sh
├── logging.test.ts              # Tests for 3 LOGGING hooks
├── automatic.test.ts            # Tests for 4 AUTOMATIC/rebuild hooks
├── ownership-check.test.ts      # Tests for ownership-check.sh
├── vitest.config.ts             # Test config
└── README.md                    # This file
```

## Running Tests

```bash
# Run all hook tests
pnpm test:hooks

# Run in watch mode (during development)
pnpm test:hooks:watch

# Run specific test file
pnpm vitest run validation.test.ts --config .claude/hooks/__tests__/vitest.config.ts
```

## Test Helpers

### executeHook(options)

Executes a bash hook with mocked JSON input via stdin.

```typescript
import { executeHookSync, HookFixtureBuilder } from './helpers/index.js';

const result = executeHookSync({
  hookName: 'validate-polling',
  input: HookFixtureBuilder.bash('sleep 60 && gh pr checks 682'),
});

// Result contains:
// - exitCode: number | null
// - stdout: string
// - stderr: string
// - logFile?: string
// - logEntries?: LogEntry[]
```

### Custom Assertions

```typescript
import {
  expectBlocked,
  expectAllowed,
  expectWarned,
  expectLogEntry,
  expectJsonOutput,
} from './helpers/index.js';

// Assert hook blocked the operation
expectBlocked(result, {
  pattern: /BLOCKED: Polling pattern/,
  suggestionIncludes: '--watch',
});

// Assert hook allowed the operation
expectAllowed(result);

// Assert hook warned but didn't block
expectWarned(result, {
  messageIncludes: 'Missing .js extension',
});

// Assert log entry exists
expectLogEntry(result, {
  level: 'WARNED',
  hook: 'detect-common-patterns',
  pattern: 'missing-js-extension',
});

// Assert JSON output (for ownership-check)
expectJsonOutput(result, {
  decision: 'block',
  reasonIncludes: 'pre-existing',
});
```

### HookFixtureBuilder

Creates mock hook input fixtures.

```typescript
import { HookFixtureBuilder } from './helpers/index.js';

// Bash tool input
HookFixtureBuilder.bash('sleep 60 && gh pr checks 682');

// Edit tool input
HookFixtureBuilder.edit('/path/to/file.ts', {
  old_string: 'old code',
  new_string: 'new code',
});

// Write tool input
HookFixtureBuilder.write('/path/to/file.ts', 'content');
```

### Temp Directory Management

```typescript
import { createTempDir, createTempFile, createMockPackage } from './helpers/index.js';

// Create temp directory
const { cleanup, path: tempDir } = createTempDir();

// Create temp file with content
const filePath = createTempFile(tempDir, 'test.ts', 'export const x = 1');

// Create mock package structure
createMockPackage(tempDir, 'common-types', {
  hasDist: false,
  hasBuildScript: true,
});

// Always cleanup
cleanup();
```

## Test Patterns

### Blocking Hook Test Pattern

```typescript
it('blocks sleep + gh pr checks polling', () => {
  const result = executeHookSync({
    hookName: 'validate-polling',
    input: HookFixtureBuilder.bash('sleep 60 && gh pr checks 682'),
  });

  expectBlocked(result, {
    pattern: /BLOCKED: Polling pattern/,
    suggestionIncludes: '--watch',
  });
});
```

### Detection Hook Test Pattern

```typescript
it('warns about missing .js extension', () => {
  const { cleanup, path: tempDir } = createTempDir();
  const testFile = createTempFile(tempDir, 'test.ts', 'import { x } from "./local"');

  const result = executeHookSync({
    hookName: 'detect-common-patterns',
    input: HookFixtureBuilder.edit(testFile, { old_string: '// old', new_string: '// new' }),
  });

  expectWarned(result, { messageIncludes: 'Missing .js extension' });
  expectLogEntry(result, { level: 'WARNED', pattern: 'missing-js-extension' });

  cleanup();
});
```

## Hook Categories

### VALIDATION Hooks (11 hooks)

| Hook                            | Purpose                             |
| ------------------------------- | ----------------------------------- |
| `validate-polling.sh`           | Block polling patterns, use --watch |
| `validate-coverage-commands.sh` | Block piping coverage output        |
| `validate-ci-output-capture.sh` | Block truncating CI output          |
| `validate-vitest-flags.sh`      | Block direct --coverage flags       |
| `validate-verify-workspace.sh`  | Block wrong verify syntax           |
| `validate-coverage-config.sh`   | Warn when editing vitest.config.ts  |
| `validate-commit-typecheck.sh`  | Block commits with TS errors        |
| `validate-gcloud-builds.sh`     | Require --region flag               |
| `validate-gcloud-builds-log.sh` | Block piping build logs             |
| `validate-gcloud-resources.sh`  | Block direct resource creation      |
| `validate-terraform.sh`         | Require cleared emulator vars       |

### DETECTION Hook (1 hook)

| Hook                        | Purpose                     |
| --------------------------- | --------------------------- |
| `detect-common-patterns.sh` | Warn about TS anti-patterns |

### LOGGING Hooks (3 hooks)

| Hook                   | Purpose                                 |
| ---------------------- | --------------------------------------- |
| `log-command-start.sh` | Record command start time               |
| `log-command-end.sh`   | Calculate duration, log to commands.log |
| `ci-phase-timing.sh`   | Parse @@PHASE_TIMING@@ markers          |

### AUTOMATIC Hooks (4 hooks)

| Hook                         | Purpose                           |
| ---------------------------- | --------------------------------- |
| `session-start-build.sh`     | Build packages when dist/ missing |
| `rebuild-after-git.sh`       | Rebuild after git operations      |
| `rebuild-on-package-edit.sh` | Rebuild package after edit        |
| `typecheck-after-edit.sh`    | Typecheck after .ts file edit     |

### OTHER Hooks (2 hooks)

| Hook                 | Purpose                             |
| -------------------- | ----------------------------------- |
| `ownership-check.sh` | Block ownership-deflecting language |
| `query-hooks.sh`     | Utility script (no tests)           |

## Adding New Hook Tests

1. **Choose the test file** based on hook category:
   - Validation hooks → `validation.test.ts`
   - Pattern detection → `detection.test.ts`
   - Logging hooks → `logging.test.ts`
   - Automatic/rebuild → `automatic.test.ts`
   - Ownership checks → `ownership-check.test.ts`

2. **Write the test**:

   ```typescript
   it('describes what the hook does', () => {
     const result = executeHookSync({
       hookName: 'your-hook-name',
       input: HookFixtureBuilder.bash('command to test'),
     });

     expectBlocked(result, { pattern: /expected message/ });
   });
   ```

3. **Run the test**:
   ```bash
   pnpm test:hooks
   ```

## Coverage

Current test coverage by hook category:

| Category   | Hooks  | Test Cases |
| ---------- | ------ | ---------- |
| VALIDATION | 11     | ~40        |
| DETECTION  | 1      | ~12        |
| LOGGING    | 3      | ~8         |
| AUTOMATIC  | 4      | ~12        |
| OWNERSHIP  | 1      | ~8         |
| **Total**  | **20** | **~80**    |

Note: `query-hooks.sh` is a utility script and doesn't require tests.
