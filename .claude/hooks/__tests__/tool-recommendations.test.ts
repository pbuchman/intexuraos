import { describe, it, beforeEach } from 'vitest';
import {
  executeHookSync,
  clearHooksLog,
  HookFixtureBuilder,
  expectAllowed,
  expectSoftBlock,
  expectLogEntry,
} from './helpers/index.js';

// Use sequential to avoid resource contention issues when running with full CI
describe.sequential('Claude Hooks - Tool Recommendations', () => {
  beforeEach(() => {
    clearHooksLog();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // grep → rg recommendations
  // ═══════════════════════════════════════════════════════════════════════════
  describe('grep → rg', () => {
    it('soft-blocks grep -r (recursive search)', () => {
      const result = executeHookSync({
        hookName: 'tool-recommendations',
        input: HookFixtureBuilder.bash('grep -r "pattern" src/'),
      });

      expectSoftBlock(result, {
        reasonIncludes: 'rg',
      });
    });

    it('soft-blocks grep -rn (recursive with line numbers)', () => {
      const result = executeHookSync({
        hookName: 'tool-recommendations',
        input: HookFixtureBuilder.bash('grep -rn "TODO" .'),
      });

      expectSoftBlock(result, {
        reasonIncludes: 'rg',
      });
    });

    it('soft-blocks grep --recursive', () => {
      const result = executeHookSync({
        hookName: 'tool-recommendations',
        input: HookFixtureBuilder.bash('grep --recursive "pattern" src/'),
      });

      expectSoftBlock(result, {
        reasonIncludes: 'rg',
      });
    });

    it('soft-blocks grep -rl (recursive, list files)', () => {
      const result = executeHookSync({
        hookName: 'tool-recommendations',
        input: HookFixtureBuilder.bash('grep -rl "import" packages/'),
      });

      expectSoftBlock(result, {
        reasonIncludes: 'rg',
      });
    });

    it('soft-blocks grep -rn with complex flags', () => {
      const result = executeHookSync({
        hookName: 'tool-recommendations',
        input: HookFixtureBuilder.bash('grep -rnE "function\\s+\\w+" apps/'),
      });

      expectSoftBlock(result, {
        reasonIncludes: 'rg',
      });
    });

    it('allows pipe grep (filtering output)', () => {
      const result = executeHookSync({
        hookName: 'tool-recommendations',
        input: HookFixtureBuilder.bash('ps aux | grep node'),
      });

      expectAllowed(result);
    });

    it('allows grep -q (conditional checks)', () => {
      const result = executeHookSync({
        hookName: 'tool-recommendations',
        input: HookFixtureBuilder.bash('echo "hello" | grep -q "hello" && echo found'),
      });

      expectAllowed(result);
    });

    it('allows grep in if conditionals', () => {
      const result = executeHookSync({
        hookName: 'tool-recommendations',
        input: HookFixtureBuilder.bash('if echo "$VAR" | grep -q pattern; then echo yes; fi'),
      });

      expectAllowed(result);
    });

    it('allows pipe grep even with recursive flags', () => {
      const result = executeHookSync({
        hookName: 'tool-recommendations',
        input: HookFixtureBuilder.bash('somecommand | grep -rn "pattern" .'),
      });

      expectAllowed(result);
    });

    it('allows rg command (the recommended alternative)', () => {
      const result = executeHookSync({
        hookName: 'tool-recommendations',
        input: HookFixtureBuilder.bash('rg "pattern" src/'),
      });

      expectAllowed(result);
    });

    it('logs WARNED entry for grep -r blocks', () => {
      const result = executeHookSync({
        hookName: 'tool-recommendations',
        input: HookFixtureBuilder.bash('grep -r "pattern" src/'),
      });

      expectLogEntry(result, {
        level: 'WARNED',
        hook: 'tool-recommendations',
        pattern: 'grep-recursive',
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // cat → bat/Read recommendations
  // ═══════════════════════════════════════════════════════════════════════════
  describe('cat → bat/Read', () => {
    it('soft-blocks cat with a file path', () => {
      const result = executeHookSync({
        hookName: 'tool-recommendations',
        input: HookFixtureBuilder.bash('cat /tmp/output.log'),
      });

      expectSoftBlock(result, {
        reasonIncludes: 'Read',
      });
    });

    it('soft-blocks cat with relative path', () => {
      const result = executeHookSync({
        hookName: 'tool-recommendations',
        input: HookFixtureBuilder.bash('cat src/index.ts'),
      });

      expectSoftBlock(result, {
        reasonIncludes: 'Read',
      });
    });

    it('allows cat with heredoc (<<)', () => {
      const result = executeHookSync({
        hookName: 'tool-recommendations',
        input: HookFixtureBuilder.bash('cat << EOF\nhello\nEOF'),
      });

      expectAllowed(result);
    });

    it('allows cat in a pipeline (stdin)', () => {
      const result = executeHookSync({
        hookName: 'tool-recommendations',
        input: HookFixtureBuilder.bash('echo "data" | cat'),
      });

      expectAllowed(result);
    });

    it('allows bat command (the recommended alternative)', () => {
      const result = executeHookSync({
        hookName: 'tool-recommendations',
        input: HookFixtureBuilder.bash('bat /tmp/output.log'),
      });

      expectAllowed(result);
    });

    it('logs WARNED entry for cat file blocks', () => {
      const result = executeHookSync({
        hookName: 'tool-recommendations',
        input: HookFixtureBuilder.bash('cat /tmp/output.log'),
      });

      expectLogEntry(result, {
        level: 'WARNED',
        hook: 'tool-recommendations',
        pattern: 'cat-file-read',
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // find → fd/Glob recommendations
  // ═══════════════════════════════════════════════════════════════════════════
  describe('find → fd/Glob', () => {
    it('soft-blocks find with -name', () => {
      const result = executeHookSync({
        hookName: 'tool-recommendations',
        input: HookFixtureBuilder.bash('find . -name "*.ts"'),
      });

      expectSoftBlock(result, {
        reasonIncludes: 'fd',
      });
    });

    it('soft-blocks find with -type', () => {
      const result = executeHookSync({
        hookName: 'tool-recommendations',
        input: HookFixtureBuilder.bash('find /repo -type f -name "*.json"'),
      });

      expectSoftBlock(result, {
        reasonIncludes: 'fd',
      });
    });

    it('soft-blocks find with -iname (case-insensitive)', () => {
      const result = executeHookSync({
        hookName: 'tool-recommendations',
        input: HookFixtureBuilder.bash('find src/ -iname "readme*"'),
      });

      expectSoftBlock(result, {
        reasonIncludes: 'fd',
      });
    });

    it('allows fd command (the recommended alternative)', () => {
      const result = executeHookSync({
        hookName: 'tool-recommendations',
        input: HookFixtureBuilder.bash('fd "*.ts" src/'),
      });

      expectAllowed(result);
    });

    it('allows find with -exec (action-oriented, not just searching)', () => {
      const result = executeHookSync({
        hookName: 'tool-recommendations',
        input: HookFixtureBuilder.bash('find /tmp -name "*.tmp" -exec rm {} \\;'),
      });

      expectAllowed(result);
    });

    it('allows find with -delete (action-oriented)', () => {
      const result = executeHookSync({
        hookName: 'tool-recommendations',
        input: HookFixtureBuilder.bash('find /tmp -name "*.tmp" -delete'),
      });

      expectAllowed(result);
    });

    it('logs WARNED entry for find search blocks', () => {
      const result = executeHookSync({
        hookName: 'tool-recommendations',
        input: HookFixtureBuilder.bash('find . -name "*.ts"'),
      });

      expectLogEntry(result, {
        level: 'WARNED',
        hook: 'tool-recommendations',
        pattern: 'find-search',
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Edge cases
  // ═══════════════════════════════════════════════════════════════════════════
  describe('edge cases', () => {
    it('allows unrelated commands', () => {
      const result = executeHookSync({
        hookName: 'tool-recommendations',
        input: HookFixtureBuilder.bash('ls -la'),
      });

      expectAllowed(result);
    });

    it('ignores non-Bash tools', () => {
      const result = executeHookSync({
        hookName: 'tool-recommendations',
        input: {
          tool_name: 'Read',
          tool_input: { file_path: '/some/path' },
        },
      });

      expectAllowed(result);
    });

    it('handles empty command gracefully', () => {
      const result = executeHookSync({
        hookName: 'tool-recommendations',
        input: HookFixtureBuilder.bash(''),
      });

      expectAllowed(result);
    });

    it('allows grep without recursive flag (single file search)', () => {
      const result = executeHookSync({
        hookName: 'tool-recommendations',
        input: HookFixtureBuilder.bash('grep "pattern" single-file.txt'),
      });

      expectAllowed(result);
    });

    it('allows git grep (different tool, not standalone grep)', () => {
      const result = executeHookSync({
        hookName: 'tool-recommendations',
        input: HookFixtureBuilder.bash('git grep "pattern"'),
      });

      expectAllowed(result);
    });

    it('allows commands that contain grep/cat/find as substrings', () => {
      const result = executeHookSync({
        hookName: 'tool-recommendations',
        input: HookFixtureBuilder.bash('npm run grep-plugin'),
      });

      expectAllowed(result);
    });
  });
});
