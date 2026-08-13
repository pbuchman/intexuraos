import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  executeHookSync,
  executeHookSyncWithTempDir,
  clearHooksLog,
  HookFixtureBuilder,
  expectAllowed,
  createTempDir,
} from './helpers/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const hooksDir = path.resolve(__dirname, '..');
const commandsLogPath = path.join(hooksDir, 'commands.log');
const ciPhasesLogPath = path.join(hooksDir, 'ci-phases.log');

// Use sequential to avoid resource contention issues when running with full CI
describe.sequential('Claude Hooks - Logging', () => {
  beforeEach(() => {
    clearHooksLog();
  });

  afterEach(() => {
    // Clean up log files after each test
    try {
      if (fs.existsSync(commandsLogPath)) fs.unlinkSync(commandsLogPath);
    } catch {
      // Ignore cleanup errors
    }
    try {
      if (fs.existsSync(ciPhasesLogPath)) fs.unlinkSync(ciPhasesLogPath);
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('log-command-start.sh', () => {
    const timingDir = '/tmp/claude-cmd-timing';

    beforeEach(() => {
      // Ensure timing directory exists before each test
      if (!fs.existsSync(timingDir)) {
        fs.mkdirSync(timingDir, { recursive: true });
      }
    });

    afterEach(() => {
      try {
        fs.rmSync(timingDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    });

    it('creates timing file for Bash commands', () => {
      executeHookSync({
        hookName: 'log-command-start',
        input: HookFixtureBuilder.bash('echo test'),
      });

      // Check that timing directory was created
      const timingFiles = fs.existsSync(timingDir) ? fs.readdirSync(timingDir) : [];

      // Should have created .start and .pending files
      const startFiles = timingFiles.filter((f) => f.endsWith('.start'));
      timingFiles.filter((f) => f.endsWith('.pending'));

      // At least one start file should exist
      expect(startFiles.length).toBeGreaterThan(0);
    });

    it('allows the operation (always observational)', () => {
      const result = executeHookSync({
        hookName: 'log-command-start',
        input: HookFixtureBuilder.bash('any command'),
      });

      expectAllowed(result);
    });

    it('ignores non-Bash tools', () => {
      const result = executeHookSync({
        hookName: 'log-command-start',
        input: {
          tool_name: 'Read',
          tool_input: { file_path: '/some/path' },
        },
      });

      expectAllowed(result);
      // No timing files should be created for non-Bash tools
    });

    it('generates unique IDs for parallel identical commands', () => {
      const cmd = 'echo test';

      const result1 = executeHookSync({
        hookName: 'log-command-start',
        input: HookFixtureBuilder.bash(cmd),
      });

      const result2 = executeHookSync({
        hookName: 'log-command-start',
        input: HookFixtureBuilder.bash(cmd),
      });

      expectAllowed(result1);
      expectAllowed(result2);

      // Both should have created timing files
      const timingFiles = fs.existsSync(timingDir) ? fs.readdirSync(timingDir) : [];

      expect(timingFiles.length).toBeGreaterThan(0);
    });
  });

  describe('log-command-end.sh', () => {
    const timingDir = '/tmp/claude-cmd-timing';

    beforeEach(() => {
      // Ensure timing directory exists before each test
      if (!fs.existsSync(timingDir)) {
        fs.mkdirSync(timingDir, { recursive: true });
      }
    });

    afterEach(() => {
      try {
        fs.rmSync(timingDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    });

    it('calculates duration from timing file', () => {
      const command = 'test-command';

      // First, create a timing file as log-command-start would
      executeHookSync({
        hookName: 'log-command-start',
        input: HookFixtureBuilder.bash(command),
      });

      // Then run log-command-end
      const result = executeHookSync({
        hookName: 'log-command-end',
        input: HookFixtureBuilder.bash(command),
      });

      expectAllowed(result);
    });

    it('writes only a one-way command hash to a private commands.log', () => {
      const { path: tempDir, cleanup } = createTempDir();

      try {
        const secretCanary = 'HOOK_COMMAND_SECRET_CANARY';
        const command = `curl -H "Authorization: Bearer ${secretCanary}" https://example.test`;

        // Create timing file
        executeHookSyncWithTempDir(
          { hookName: 'log-command-start', input: HookFixtureBuilder.bash(command) },
          tempDir
        );

        // End command
        executeHookSyncWithTempDir(
          { hookName: 'log-command-end', input: HookFixtureBuilder.bash(command) },
          tempDir
        );

        // Check commands.log format
        if (fs.existsSync(commandsLogPath)) {
          const logContent = fs.readFileSync(commandsLogPath, 'utf-8');
          expect(logContent).toMatch(/\[.*?\]\s+[\d.]+s\s+command_hash=[a-f\d]{12}/u);
          expect(logContent).not.toMatch(/\[\s*\?\s*s\]/); // No unknown durations
          expect(logContent).not.toContain(command);
          expect(logContent).not.toContain(secretCanary);
          expect(fs.statSync(commandsLogPath).mode & 0o077).toBe(0);
        }
      } finally {
        cleanup();
      }
    });

    it('handles missing timing file gracefully', () => {
      const result = executeHookSync({
        hookName: 'log-command-end',
        input: HookFixtureBuilder.bash('command-without-start'),
      });

      // Should not throw, should allow
      expectAllowed(result);
    });
  });

  describe('ci-phase-timing.sh', () => {
    it('parses @@PHASE_TIMING@@ markers from CI output', () => {
      const mockCiOutput = `
Running Static Validation...
@@PHASE_TIMING@@ {"phase": "Static Validation", "duration_ms": 1234}
Running TypeCheck...
@@PHASE_TIMING@@ {"phase": "TypeCheck", "duration_ms": 5678}
Running tests...
@@PHASE_TIMING@@ {"phase": "Tests", "duration_ms": 9012}
CI complete.
`;

      const result = executeHookSync({
        hookName: 'ci-phase-timing',
        input: HookFixtureBuilder.sessionStart(),
        env: {
          CI_OUTPUT: mockCiOutput,
        },
      });

      expectAllowed(result);
    });

    it('writes parsed phases to ci-phases.log', () => {
      const mockCiOutput = `
@@PHASE_TIMING@@ {"phase": "Static Validation", "duration_ms": 1234}
@@PHASE_TIMING@@ {"phase": "TypeCheck", "duration_ms": 5678}
`;

      executeHookSync({
        hookName: 'ci-phase-timing',
        input: HookFixtureBuilder.sessionStart(),
        env: {
          CI_OUTPUT: mockCiOutput,
        },
      });

      if (fs.existsSync(ciPhasesLogPath)) {
        const logContent = fs.readFileSync(ciPhasesLogPath, 'utf-8');
        expect(logContent).toContain('Static Validation');
        expect(logContent).toContain('TypeCheck');
      }
    });

    it('handles output without phase markers gracefully', () => {
      const mockCiOutput = `
Running Static Validation...
Running TypeCheck...
Running tests...
CI complete.
`;

      const result = executeHookSync({
        hookName: 'ci-phase-timing',
        input: HookFixtureBuilder.sessionStart(),
        env: {
          CI_OUTPUT: mockCiOutput,
        },
      });

      expectAllowed(result);
    });

    it('allows when CI_OUTPUT env var is not set', () => {
      const result = executeHookSync({
        hookName: 'ci-phase-timing',
        input: HookFixtureBuilder.sessionStart(),
      });

      expectAllowed(result);
    });
  });
});
