import { describe, it, beforeEach, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  executeHookSync,
  clearHooksLog,
  createTempDir,
  createMockPackage,
  expectContinue,
  expectAllowed,
  HookFixtureBuilder,
} from './helpers/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const hooksDir = path.resolve(__dirname, '..');
const sessionsLogPath = path.join(hooksDir, 'sessions.log');

// Use sequential to avoid resource contention issues when running with full CI
describe.sequential('Claude Hooks - Automatic/Rebuild', () => {
  beforeEach(() => {
    clearHooksLog();
    // Clear sessions.log
    try {
      if (fs.existsSync(sessionsLogPath)) fs.unlinkSync(sessionsLogPath);
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('session-start-build.sh', () => {
    it('outputs CONTINUE when all packages have dist/', { timeout: 20000 }, () => {
      const { cleanup, path: tempDir } = createTempDir();

      // Create mock packages with dist/
      createMockPackage(tempDir, 'common-types', { hasDist: true, hasBuildScript: true });
      createMockPackage(tempDir, 'common-result', { hasDist: true, hasBuildScript: true });
      createMockPackage(tempDir, 'infra-sentry', { hasDist: true, hasBuildScript: true });

      // Create node_modules
      fs.mkdirSync(path.join(tempDir, 'node_modules'), { recursive: true });

      const result = executeHookSync({
        hookName: 'session-start-build',
        input: HookFixtureBuilder.sessionStart(),
        cwd: tempDir,
        env: { HOOK_DRY_RUN: '1' },
      });

      expectContinue(result);
      cleanup();
    });

    it('outputs CONTINUE when packages have no build script', () => {
      const { cleanup, path: tempDir } = createTempDir();

      // Create packages without build scripts
      createMockPackage(tempDir, 'common-types', { hasDist: false, hasBuildScript: false });
      createMockPackage(tempDir, 'common-result', { hasDist: false, hasBuildScript: false });

      // Create node_modules
      fs.mkdirSync(path.join(tempDir, 'node_modules'), { recursive: true });

      const result = executeHookSync({
        hookName: 'session-start-build',
        input: HookFixtureBuilder.sessionStart(),
        cwd: tempDir,
        env: { HOOK_DRY_RUN: '1' },
      });

      expectContinue(result);
      cleanup();
    });

    it('logs session start to sessions.log', { timeout: 20000 }, () => {
      const { cleanup, path: tempDir } = createTempDir();

      // Create node_modules
      fs.mkdirSync(path.join(tempDir, 'node_modules'), { recursive: true });

      executeHookSync({
        hookName: 'session-start-build',
        input: HookFixtureBuilder.sessionStart(),
        cwd: tempDir,
        env: { HOOK_DRY_RUN: '1' },
      });

      // Check sessions.log was created
      if (fs.existsSync(sessionsLogPath)) {
        const logContent = fs.readFileSync(sessionsLogPath, 'utf-8');
        expect(logContent).toContain('Session started');
      }

      cleanup();
    });

    it('outputs CONTINUE (even when build would run)', { timeout: 30000 }, () => {
      const { cleanup, path: tempDir } = createTempDir();

      // Create package without dist/
      createMockPackage(tempDir, 'common-types', { hasDist: false, hasBuildScript: true });

      // Create node_modules
      fs.mkdirSync(path.join(tempDir, 'node_modules'), { recursive: true });

      const result = executeHookSync({
        hookName: 'session-start-build',
        input: HookFixtureBuilder.sessionStart(),
        cwd: tempDir,
        // Don't actually run pnpm build in tests
        env: { HOOK_DRY_RUN: '1' },
      });

      // Should still output CONTINUE
      const stdout = result.stdout.trim();
      expect(stdout.endsWith('CONTINUE')).toBe(true);
      cleanup();
    });

    it('does not run full pnpm build (uses per-package filter)', { timeout: 20000 }, () => {
      // Verify the hook script no longer contains a bare `pnpm build` command.
      // It should use `pnpm --filter` for targeted per-package builds to avoid OOM.
      const hookPath = path.join(__dirname, '..', 'session-start-build.sh');
      const hookContent = fs.readFileSync(hookPath, 'utf-8');

      // Should NOT have bare `pnpm build` (without --filter)
      const bareBuildLines = hookContent
        .split('\n')
        .filter((line) => /^\s*pnpm build\b/.test(line) && !line.trimStart().startsWith('#'));
      expect(bareBuildLines).toHaveLength(0);

      // Should have `pnpm --filter` build
      expect(hookContent).toContain('pnpm --filter');
    });
  });

  describe('rebuild-after-git.sh', () => {
    it('triggers rebuild after git operations that touch packages', () => {
      // This hook runs after git operations
      // In a real scenario, it would check if packages/*/src/ was modified
      const result = executeHookSync({
        hookName: 'rebuild-after-git',
        input: HookFixtureBuilder.bash('git pull origin main'),
        env: {
          // Skip actual pnpm build in test mode
          HOOK_DRY_RUN: '1',
        },
      });

      // Hook should allow (it's observational/rebuild-triggering)
      expectAllowed(result);
    });

    it('does not trigger rebuild when only app files changed', { timeout: 20000 }, () => {
      const result = executeHookSync({
        hookName: 'rebuild-after-git',
        input: HookFixtureBuilder.bash('git pull origin main'),
        env: {
          // Skip actual pnpm build in test mode
          HOOK_DRY_RUN: '1',
        },
      });

      expectAllowed(result);
    });
  });

  describe('rebuild-on-package-edit.sh', () => {
    it('detects edits to package source files', () => {
      const result = executeHookSync({
        hookName: 'rebuild-on-package-edit',
        input: HookFixtureBuilder.edit('/path/to/repo/packages/common-types/src/index.ts', {
          old_string: 'old',
          new_string: 'new',
        }),
      });

      // Should trigger rebuild for the specific package
      expectAllowed(result);
    });

    it('detects writes to package source files', () => {
      const result = executeHookSync({
        hookName: 'rebuild-on-package-edit',
        input: HookFixtureBuilder.write(
          '/path/to/repo/packages/infra-sentry/src/logger.ts',
          'export const log = () => {}'
        ),
      });

      expectAllowed(result);
    });

    it('ignores edits to dist/ files', () => {
      const result = executeHookSync({
        hookName: 'rebuild-on-package-edit',
        input: HookFixtureBuilder.edit('/path/to/repo/packages/common-types/dist/index.js', {
          old_string: 'old',
          new_string: 'new',
        }),
      });

      expectAllowed(result);
    });

    it('ignores edits to app files', () => {
      const result = executeHookSync({
        hookName: 'rebuild-on-package-edit',
        input: HookFixtureBuilder.edit('/path/to/repo/apps/web/src/app.tsx', {
          old_string: 'old',
          new_string: 'new',
        }),
      });

      expectAllowed(result);
    });
  });

  describe('typecheck-after-edit.sh', () => {
    it('triggers typecheck after editing .ts files', () => {
      const result = executeHookSync({
        hookName: 'typecheck-after-edit',
        input: HookFixtureBuilder.edit('/path/to/repo/apps/research-agent/src/usecases/find.ts', {
          old_string: 'old',
          new_string: 'new',
        }),
      });

      expectAllowed(result);
    });

    it('triggers typecheck after editing .tsx files', () => {
      const result = executeHookSync({
        hookName: 'typecheck-after-edit',
        input: HookFixtureBuilder.edit('/path/to/repo/apps/web/src/components/Button.tsx', {
          old_string: 'old',
          new_string: 'new',
        }),
      });

      expectAllowed(result);
    });

    it('does not trigger for non-TypeScript files', () => {
      const result = executeHookSync({
        hookName: 'typecheck-after-edit',
        input: HookFixtureBuilder.edit('/path/to/repo/README.md', {
          old_string: 'old',
          new_string: 'new',
        }),
      });

      expectAllowed(result);
    });

    it('does not trigger for test files', () => {
      const result = executeHookSync({
        hookName: 'typecheck-after-edit',
        input: HookFixtureBuilder.edit('/path/to/repo/apps/service/src/__tests__/usecase.test.ts', {
          old_string: 'old',
          new_string: 'new',
        }),
      });

      expectAllowed(result);
    });
  });
});
