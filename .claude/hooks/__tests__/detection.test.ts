import { describe, it, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  executeHookSync,
  clearHooksLog,
  createTempFile,
  createTempDir,
  expectWarned,
  expectAllowed,
  expectLogEntry,
  expectNoLogEntry,
  expectSoftBlock,
} from './helpers/index.js';

// Use sequential to avoid resource contention issues when running with full CI
describe.sequential('Claude Hooks - Pattern Detection', () => {
  const { path: testBaseDir, cleanup: cleanupTempDir } = createTempDir();

  beforeEach(() => {
    clearHooksLog();
  });

  afterAll(() => {
    cleanupTempDir();
  });

  describe('detect-common-patterns.sh', () => {
    // Create a temporary TypeScript file for testing
    function createTestFile(fileName: string, content: string): string {
      return createTempFile(testBaseDir, fileName, content);
    }

    describe('missing .js extension detection', () => {
      it('soft-blocks on relative import without .js extension', () => {
        const testFile = createTestFile(
          'test.ts',
          `import { foo } from "./local"
import { bar } from '../utils/helper'

export const test = foo`
        );

        if (!fs.existsSync(testFile)) {
          throw new Error(`Test file not found: ${testFile}`);
        }

        const result = executeHookSync({
          hookName: 'detect-common-patterns',
          input: {
            tool_name: 'Edit',
            tool_input: {
              file_path: testFile,
              old_string: '// old',
              new_string: '// new',
            },
          },
        });

        // Now outputs JSON soft block instead of just warning
        expectSoftBlock(result, {
          reasonIncludes: 'PATTERN DETECTION',
          stderrIncludes: 'missing-js-extension',
        });

        if (result.logEntries && result.logEntries.length > 0) {
          expectLogEntry(result, {
            level: 'WARNED',
            hook: 'detect-common-patterns',
            pattern: 'missing-js-extension',
          });
        }
      });

      it('allows import with @allow-missing-js suppression', () => {
        const testFile = createTestFile(
          'suppressed.ts',
          `import { foo } from "./local" // @allow-missing-js -- directory with index.ts

export const test = foo`
        );

        const result = executeHookSync({
          hookName: 'detect-common-patterns',
          input: {
            tool_name: 'Edit',
            tool_input: {
              file_path: testFile,
              old_string: '// old',
              new_string: '// new',
            },
          },
        });

        expectAllowed(result);
        if (result.logEntries && result.logEntries.length > 0) {
          expectLogEntry(result, {
            level: 'INFO',
            pattern: 'suppressed-missing-js',
          });
        }
      });

      it('does not warn for imports with .js extension', () => {
        const testFile = createTestFile(
          'good.ts',
          `import { foo } from "./local.js"
import { bar } from '../utils/helper.js'

export const test = foo`
        );

        const result = executeHookSync({
          hookName: 'detect-common-patterns',
          input: {
            tool_name: 'Edit',
            tool_input: {
              file_path: testFile,
              old_string: '// old',
              new_string: '// new',
            },
          },
        });

        expectAllowed(result);
        expectNoLogEntry(result, { pattern: 'missing-js-extension' });
      });

      it('does not warn for .json imports', () => {
        const testFile = createTestFile('json-import.ts', `import data from './config.json'`);

        const result = executeHookSync({
          hookName: 'detect-common-patterns',
          input: {
            tool_name: 'Edit',
            tool_input: {
              file_path: testFile,
              old_string: '// old',
              new_string: '// new',
            },
          },
        });

        expectNoLogEntry(result, { pattern: 'missing-js-extension' });
      });

      it('does not warn for node_modules imports', () => {
        const testFile = createTestFile(
          'npm-import.ts',
          `import { pino } from 'pino'
import { describe } from 'vitest'`
        );

        const result = executeHookSync({
          hookName: 'detect-common-patterns',
          input: {
            tool_name: 'Edit',
            tool_input: {
              file_path: testFile,
              old_string: '// old',
              new_string: '// new',
            },
          },
        });

        expectNoLogEntry(result, { pattern: 'missing-js-extension' });
      });

      it('ignores non-TypeScript files', () => {
        const testFile = createTestFile('test.js', `import { foo } from "./local"`);

        const result = executeHookSync({
          hookName: 'detect-common-patterns',
          input: {
            tool_name: 'Edit',
            tool_input: {
              file_path: testFile,
              old_string: '// old',
              new_string: '// new',
            },
          },
        });

        expectAllowed(result);
      });

      it('ignores .d.ts type definition files', () => {
        const testFile = createTestFile('types.d.ts', `import { Type } from "./external"`);

        const result = executeHookSync({
          hookName: 'detect-common-patterns',
          input: {
            tool_name: 'Edit',
            tool_input: {
              file_path: testFile,
              old_string: '// old',
              new_string: '// new',
            },
          },
        });

        expectAllowed(result);
      });
    });

    describe('bad | undefined type detection', () => {
      it('soft-blocks on | undefined in type annotations', () => {
        const testFile = createTestFile(
          'types.ts',
          `interface User {
  name: string
  age: number | undefined
  email: string | undefined
}`
        );

        const result = executeHookSync({
          hookName: 'detect-common-patterns',
          input: {
            tool_name: 'Edit',
            tool_input: {
              file_path: testFile,
              old_string: '// old',
              new_string: '// new',
            },
          },
        });

        expectSoftBlock(result, {
          reasonIncludes: 'PATTERN DETECTION',
          stderrIncludes: 'bad-undefined-type',
        });

        if (result.logEntries && result.logEntries.length > 0) {
          expectLogEntry(result, {
            level: 'WARNED',
            hook: 'detect-common-patterns',
            pattern: 'bad-undefined-type',
          });
        }
      });

      it('allows | undefined with @allow-undefined-type suppression', () => {
        const testFile = createTestFile(
          'suppressed-types.ts',
          `interface User {
  name: string
  age: number | undefined // @allow-undefined-type -- exact optional semantics needed
}`
        );

        const result = executeHookSync({
          hookName: 'detect-common-patterns',
          input: {
            tool_name: 'Edit',
            tool_input: {
              file_path: testFile,
              old_string: '// old',
              new_string: '// new',
            },
          },
        });

        expectAllowed(result);
      });

      it('does not warn for optional properties with ?', () => {
        const testFile = createTestFile(
          'good-types.ts',
          `interface User {
  name: string
  age?: number
  email?: string
}`
        );

        const result = executeHookSync({
          hookName: 'detect-common-patterns',
          input: {
            tool_name: 'Edit',
            tool_input: {
              file_path: testFile,
              old_string: '// old',
              new_string: '// new',
            },
          },
        });

        expectNoLogEntry(result, { pattern: 'bad-undefined-type' });
      });

      it(
        'does not warn for | undefined in function return type position',
        { timeout: 20000 },
        () => {
          const testFile = createTestFile(
            'function.ts',
            `function getValue(): string | undefined {
  return undefined
}`
          );

          const result = executeHookSync({
            hookName: 'detect-common-patterns',
            input: {
              tool_name: 'Edit',
              tool_input: {
                file_path: testFile,
                old_string: '// old',
                new_string: '// new',
              },
            },
          });

          // The hook only checks property-level annotations, not function returns
          // So this should not trigger a warning
          expectNoLogEntry(result, { pattern: 'bad-undefined-type' });
        }
      );
    });

    describe('Result.value without .ok detection', () => {
      it('soft-blocks on accessing .value without .ok check', () => {
        const testFile = createTestFile(
          'result.ts',
          `const result = await repo.find(id)
return result.value`
        );

        const result = executeHookSync({
          hookName: 'detect-common-patterns',
          input: {
            tool_name: 'Edit',
            tool_input: {
              file_path: testFile,
              old_string: '// old',
              new_string: '// new',
            },
          },
        });

        expectSoftBlock(result, {
          reasonIncludes: 'PATTERN DETECTION',
          stderrIncludes: 'result-value-without-ok',
        });

        if (result.logEntries && result.logEntries.length > 0) {
          expectLogEntry(result, {
            level: 'WARNED',
            hook: 'detect-common-patterns',
            pattern: 'result-value-without-ok',
          });
        }
      });

      it('allows .value access with @allow-result-access suppression', () => {
        const testFile = createTestFile(
          'suppressed-result.ts',
          `const result = await repo.find(id)
return result.value // @allow-result-access -- narrowed in calling function`
        );

        const result = executeHookSync({
          hookName: 'detect-common-patterns',
          input: {
            tool_name: 'Edit',
            tool_input: {
              file_path: testFile,
              old_string: '// old',
              new_string: '// new',
            },
          },
        });

        expectAllowed(result);
      });

      it('does not warn when .ok check is present before .value', () => {
        const testFile = createTestFile(
          'safe-result.ts',
          `const result = await repo.find(id)
if (!result.ok) return result
return result.value`
        );

        const result = executeHookSync({
          hookName: 'detect-common-patterns',
          input: {
            tool_name: 'Edit',
            tool_input: {
              file_path: testFile,
              old_string: '// old',
              new_string: '// new',
            },
          },
        });

        expectNoLogEntry(result, { pattern: 'result-value-without-ok' });
      });

      it('does not warn for early return pattern', () => {
        const testFile = createTestFile(
          'early-return.ts',
          `const result = await repo.find(id)
if (result.ok === false) {
  return result
}
return result.value`
        );

        const result = executeHookSync({
          hookName: 'detect-common-patterns',
          input: {
            tool_name: 'Edit',
            tool_input: {
              file_path: testFile,
              old_string: '// old',
              new_string: '// new',
            },
          },
        });

        expectNoLogEntry(result, { pattern: 'result-value-without-ok' });
      });

      it('does not warn for ternary check pattern', () => {
        const testFile = createTestFile(
          'ternary.ts',
          `const result = await repo.find(id)
return result.ok ? result.value : defaultValue`
        );

        const result = executeHookSync({
          hookName: 'detect-common-patterns',
          input: {
            tool_name: 'Edit',
            tool_input: {
              file_path: testFile,
              old_string: '// old',
              new_string: '// new',
            },
          },
        });

        expectNoLogEntry(result, { pattern: 'result-value-without-ok' });
      });
    });

    // Note: No afterEach cleanup here because testBaseDir is shared across all tests.
    // Temp files in /tmp will be cleaned up by OS eventually.
    // afterEach(() => {
    //   cleanupBaseDir();
    // });

    describe('Write tool detection', () => {
      it('soft-blocks on patterns in newly written files', { timeout: 20000 }, () => {
        const testFile = createTestFile(
          'new-file.ts',
          `import { foo } from "./local"
const result = await repo.find(id)
return result.value`
        );

        const result = executeHookSync({
          hookName: 'detect-common-patterns',
          input: {
            tool_name: 'Write',
            tool_input: {
              file_path: testFile,
              content: `import { foo } from "./local"
const result = await repo.find(id)
return result.value`,
            },
          },
        });

        // Should soft-block with JSON decision
        expectSoftBlock(result, {
          reasonIncludes: 'PATTERN DETECTION',
        });
      });
    });

    describe('v8 ignore addition detection', () => {
      it('soft-blocks Edit adding v8 ignore', () => {
        const testFile = createTestFile('v8-edit.ts', 'export const x = 1;');

        const result = executeHookSync({
          hookName: 'detect-common-patterns',
          input: {
            tool_name: 'Edit',
            tool_input: {
              file_path: testFile,
              old_string: 'export const x = 1;',
              new_string: '/* v8 ignore ts-type -- reason @preserve */\nexport const x = 1;',
            },
          },
        });

        expectSoftBlock(result, {
          stderrIncludes: 'v8-ignore-added',
        });
      });

      it('soft-blocks Write creating file with v8 ignore', () => {
        const testFile = createTestFile(
          'v8-write.ts',
          '/* v8 ignore ts-type -- reason @preserve */\nexport const x = 1;'
        );

        const result = executeHookSync({
          hookName: 'detect-common-patterns',
          input: {
            tool_name: 'Write',
            tool_input: {
              file_path: testFile,
              content: '/* v8 ignore ts-type -- reason @preserve */\nexport const x = 1;',
            },
          },
        });

        expectSoftBlock(result, {
          stderrIncludes: 'v8-ignore-added',
        });
      });

      it('allows Edit without v8 ignore', () => {
        const testFile = createTestFile('v8-normal.ts', 'export const x = 1;');

        const result = executeHookSync({
          hookName: 'detect-common-patterns',
          input: {
            tool_name: 'Edit',
            tool_input: {
              file_path: testFile,
              old_string: 'export const x = 1;',
              new_string: 'export const y = 2;',
            },
          },
        });

        expectAllowed(result);
        expectNoLogEntry(result, { pattern: 'v8-ignore-added' });
      });

      it('skips test files', () => {
        const testFile = createTestFile('example.test.ts', 'export const x = 1;');

        const result = executeHookSync({
          hookName: 'detect-common-patterns',
          input: {
            tool_name: 'Edit',
            tool_input: {
              file_path: testFile,
              old_string: 'export const x = 1;',
              new_string: '/* v8 ignore ts-type -- reason @preserve */\nexport const x = 1;',
            },
          },
        });

        expectNoLogEntry(result, { pattern: 'v8-ignore-added' });
      });

      it('skips non-TypeScript files', () => {
        const testFile = createTestFile('readme.md', '# Test');

        const result = executeHookSync({
          hookName: 'detect-common-patterns',
          input: {
            tool_name: 'Edit',
            tool_input: {
              file_path: testFile,
              old_string: '# Test',
              new_string: '/* v8 ignore ts-type -- reason @preserve */\n# Test',
            },
          },
        });

        expectAllowed(result);
      });

      it('includes educational message in output', () => {
        const testFile = createTestFile('v8-msg.ts', 'export const x = 1;');

        const result = executeHookSync({
          hookName: 'detect-common-patterns',
          input: {
            tool_name: 'Edit',
            tool_input: {
              file_path: testFile,
              old_string: 'export const x = 1;',
              new_string: '/* v8 ignore ts-type -- reason @preserve */\nexport const x = 1;',
            },
          },
        });

        expectSoftBlock(result, {
          stderrIncludes: 'REQUIRED WORKFLOW',
        });
      });
    });

    describe('non-TypeScript files are ignored', () => {
      it('ignores .js files', () => {
        const testFile = createTestFile(
          'script.js',
          `const result = await repo.find(id); return result.value;`
        );

        const result = executeHookSync({
          hookName: 'detect-common-patterns',
          input: {
            tool_name: 'Edit',
            tool_input: {
              file_path: testFile,
              old_string: '// old',
              new_string: '// new',
            },
          },
        });

        expectAllowed(result);
      });

      it('soft-blocks .tsx files with missing .js extension', { timeout: 20000 }, () => {
        const testFile = createTestFile(
          'component.tsx',
          `import { foo } from "./local"
export default function Component() { return null }`
        );

        const result = executeHookSync({
          hookName: 'detect-common-patterns',
          input: {
            tool_name: 'Edit',
            tool_input: {
              file_path: testFile,
              old_string: '// old',
              new_string: '// new',
            },
          },
        });

        // .tsx files ARE checked and now soft-block
        expectSoftBlock(result, {
          stderrIncludes: 'missing-js-extension',
        });
      });
    });
  });
});
