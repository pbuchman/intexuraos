import { describe, it, beforeEach, expect } from 'vitest';
import {
  executeHookSync,
  clearHooksLog,
  HookFixtureBuilder,
  expectBlocked,
  expectAllowed,
} from './helpers/index.js';

// Use sequential to avoid resource contention issues when running with full CI
describe.sequential('Claude Hooks - Validation', () => {
  beforeEach(() => {
    clearHooksLog();
  });

  describe('validate-polling.sh', () => {
    it('blocks sleep + gh pr checks polling pattern', () => {
      const result = executeHookSync({
        hookName: 'validate-polling',
        input: HookFixtureBuilder.bash('sleep 60 && gh pr checks 682'),
      });

      expectBlocked(result, {
        pattern: /BLOCKED/i,
        suggestionIncludes: '--watch',
      });
    });

    it('blocks while loop-based gh checks polling', () => {
      const result = executeHookSync({
        hookName: 'validate-polling',
        input: HookFixtureBuilder.bash('while true; do gh pr checks 123; sleep 60; done'),
      });

      expectBlocked(result, {
        pattern: /BLOCKED/i,
        messageIncludes: 'Loop-based polling',
      });
    });

    it('blocks for loop-based gh checks polling', () => {
      const result = executeHookSync({
        hookName: 'validate-polling',
        input: HookFixtureBuilder.bash('for i in {1..10}; do gh pr checks 123; sleep 30; done'),
      });

      expectBlocked(result, {
        pattern: /BLOCKED/i,
      });
    });

    it('blocks sleep + gh run view polling', () => {
      const result = executeHookSync({
        hookName: 'validate-polling',
        input: HookFixtureBuilder.bash('sleep 60 && gh run view 12345'),
      });

      expectBlocked(result, {
        pattern: /BLOCKED/i,
        suggestionIncludes: 'gh run watch',
      });
    });

    it('blocks sleep + gh run list polling', () => {
      const result = executeHookSync({
        hookName: 'validate-polling',
        input: HookFixtureBuilder.bash('sleep 60 && gh run list --workflow=e2e.yml'),
      });

      expectBlocked(result, {
        pattern: /BLOCKED/i,
      });
    });

    it('blocks sleep + gcloud builds describe polling', () => {
      const result = executeHookSync({
        hookName: 'validate-polling',
        input: HookFixtureBuilder.bash(
          'sleep 300 && gcloud builds describe 12345 --format="value(status)"'
        ),
      });

      expectBlocked(result, {
        pattern: /BLOCKED/i,
        suggestionIncludes: '--stream',
      });
    });

    it('allows gh pr checks with --watch flag', { timeout: 20000 }, () => {
      const result = executeHookSync({
        hookName: 'validate-polling',
        input: HookFixtureBuilder.bash('gh pr checks 682 --watch'),
      });

      expectAllowed(result);
    });

    it('allows gh run watch command', () => {
      const result = executeHookSync({
        hookName: 'validate-polling',
        input: HookFixtureBuilder.bash('gh run watch 12345'),
      });

      expectAllowed(result);
    });

    it('allows gcloud builds log with --stream', () => {
      const result = executeHookSync({
        hookName: 'validate-polling',
        input: HookFixtureBuilder.bash('gcloud builds log 12345 --stream --region=us-central1'),
      });

      expectAllowed(result);
    });

    it('ignores non-Bash tools', () => {
      const result = executeHookSync({
        hookName: 'validate-polling',
        input: {
          tool_name: 'Read',
          tool_input: { file_path: '/some/path' },
        },
      });

      expectAllowed(result);
    });
  });

  describe('validate-coverage-commands.sh', () => {
    it('blocks piping coverage output to grep', { timeout: 20000 }, () => {
      const result = executeHookSync({
        hookName: 'validate-coverage-commands',
        input: HookFixtureBuilder.bash('pnpm test:coverage | grep -E "Lines|Branches"'),
      });

      expectBlocked(result, {
        pattern: /BLOCKED/i,
      });
    });

    it('blocks tailing coverage output', () => {
      const result = executeHookSync({
        hookName: 'validate-coverage-commands',
        input: HookFixtureBuilder.bash('pnpm coverage 2>&1 | tail -20'),
      });

      expectBlocked(result, {
        pattern: /BLOCKED/i,
      });
    });

    it('blocks head on coverage output', () => {
      const result = executeHookSync({
        hookName: 'validate-coverage-commands',
        input: HookFixtureBuilder.bash('pnpm test:coverage | head -50'),
      });

      expectBlocked(result, {
        pattern: /BLOCKED/i,
      });
    });

    it('allows querying coverage-summary.json with jq', () => {
      const result = executeHookSync({
        hookName: 'validate-coverage-commands',
        input: HookFixtureBuilder.bash('jq .total.branches.pct coverage/coverage-summary.json'),
      });

      expectAllowed(result);
    });
  });

  describe('validate-ci-output-capture.sh', () => {
    it('blocks piping CI output to head', () => {
      const result = executeHookSync({
        hookName: 'validate-ci-output-capture',
        input: HookFixtureBuilder.bash('pnpm run ci | head -50'),
      });

      expectBlocked(result, {
        pattern: /BLOCKED/i,
      });
    });

    it('blocks piping CI stderr to tail', () => {
      const result = executeHookSync({
        hookName: 'validate-ci-output-capture',
        input: HookFixtureBuilder.bash('pnpm run ci 2>&1 | tail -20'),
      });

      expectBlocked(result, {
        pattern: /BLOCKED/i,
      });
    });

    it('allows piping CI output to tee for capture', () => {
      const result = executeHookSync({
        hookName: 'validate-ci-output-capture',
        input: HookFixtureBuilder.bash('pnpm run ci 2>&1 | tee /tmp/ci-output.txt'),
      });

      expectAllowed(result);
    });

    it('allows redirecting CI output to file', () => {
      const result = executeHookSync({
        hookName: 'validate-ci-output-capture',
        input: HookFixtureBuilder.bash('pnpm run ci > /tmp/ci.txt 2>&1'),
      });

      expectAllowed(result);
    });
  });

  describe('validate-vitest-flags.sh', () => {
    it('blocks --coverage.reporter flag', () => {
      const result = executeHookSync({
        hookName: 'validate-vitest-flags',
        input: HookFixtureBuilder.bash('vitest run --coverage.reporter=text'),
      });

      expectBlocked(result, {
        pattern: /BLOCKED/i,
      });
    });

    it('blocks --coverage after -- separator', () => {
      const result = executeHookSync({
        hookName: 'validate-vitest-flags',
        input: HookFixtureBuilder.bash('pnpm test -- --coverage'),
      });

      expectBlocked(result, {
        pattern: /BLOCKED/i,
      });
    });

    it('blocks combined coverage flags', () => {
      const result = executeHookSync({
        hookName: 'validate-vitest-flags',
        input: HookFixtureBuilder.bash('vitest --coverage --coverage.reporter=json'),
      });

      expectBlocked(result, {
        pattern: /BLOCKED/i,
      });
    });

    it('allows using test:coverage script', () => {
      const result = executeHookSync({
        hookName: 'validate-vitest-flags',
        input: HookFixtureBuilder.bash('pnpm test:coverage'),
      });

      expectAllowed(result);
    });

    it('allows vitest run without coverage flags', () => {
      const result = executeHookSync({
        hookName: 'validate-vitest-flags',
        input: HookFixtureBuilder.bash('vitest run'),
      });

      expectAllowed(result);
    });
  });

  describe('validate-verify-workspace.sh', () => {
    it('blocks verify:workspace with -- separator', () => {
      const result = executeHookSync({
        hookName: 'validate-verify-workspace',
        input: HookFixtureBuilder.bash('pnpm verify:workspace -- research-agent'),
      });

      expectBlocked(result, {
        pattern: /BLOCKED/i,
      });
    });

    it('blocks direct node scripts/verify execution', () => {
      const result = executeHookSync({
        hookName: 'validate-verify-workspace',
        input: HookFixtureBuilder.bash('node scripts/verify-workspace.sh research-agent'),
      });

      expectBlocked(result, {
        pattern: /BLOCKED/i,
      });
    });

    it('allows correct verify:workspace syntax', () => {
      const result = executeHookSync({
        hookName: 'validate-verify-workspace',
        input: HookFixtureBuilder.bash('pnpm verify:workspace research-agent'),
      });

      expectAllowed(result);
    });

    it('allows verify:workspace:tracked syntax', () => {
      const result = executeHookSync({
        hookName: 'validate-verify-workspace',
        input: HookFixtureBuilder.bash('pnpm verify:workspace:tracked research-agent'),
      });

      expectAllowed(result);
    });
  });

  describe('validate-coverage-config.sh', () => {
    it('warns when editing vitest.config.ts', () => {
      const result = executeHookSync({
        hookName: 'validate-coverage-config',
        input: HookFixtureBuilder.edit('/path/to/vitest.config.ts', {
          old_string: 'thresholds: 95',
          new_string: 'thresholds: 80',
        }),
      });

      // This hook outputs WARNING to stderr but exits 0
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toContain('WARNING');
    });

    it('does not warn for non-config files', () => {
      const result = executeHookSync({
        hookName: 'validate-coverage-config',
        input: HookFixtureBuilder.edit('/path/to/service.ts', {
          old_string: 'foo',
          new_string: 'bar',
        }),
      });

      expectAllowed(result);
    });
  });

  describe('validate-gcloud-builds.sh', () => {
    it('blocks gcloud builds describe without --region', () => {
      const result = executeHookSync({
        hookName: 'validate-gcloud-builds',
        input: HookFixtureBuilder.bash('gcloud builds describe 12345'),
      });

      expectBlocked(result, {
        pattern: /BLOCKED/i,
        messageIncludes: '--region',
      });
    });

    it('allows gcloud builds describe with --region', () => {
      const result = executeHookSync({
        hookName: 'validate-gcloud-builds',
        input: HookFixtureBuilder.bash('gcloud builds describe 12345 --region=us-central1'),
      });

      expectAllowed(result);
    });

    it('blocks gcloud builds list (requires --region)', () => {
      const result = executeHookSync({
        hookName: 'validate-gcloud-builds',
        input: HookFixtureBuilder.bash('gcloud builds list'),
      });

      expectBlocked(result, {
        pattern: /BLOCKED/i,
        messageIncludes: '--region',
      });
    });
  });

  describe('validate-gcloud-builds-log.sh', () => {
    it('blocks piping gcloud builds log to grep', () => {
      const result = executeHookSync({
        hookName: 'validate-gcloud-builds-log',
        input: HookFixtureBuilder.bash('gcloud builds log 12345 --stream | grep ERROR'),
      });

      expectBlocked(result, {
        pattern: /BLOCKED/i,
      });
    });

    it('blocks piping gcloud builds log to tail', () => {
      const result = executeHookSync({
        hookName: 'validate-gcloud-builds-log',
        input: HookFixtureBuilder.bash('gcloud builds log 12345 | tail -100'),
      });

      expectBlocked(result, {
        pattern: /BLOCKED/i,
      });
    });

    it('allows gcloud builds log with --stream', () => {
      const result = executeHookSync({
        hookName: 'validate-gcloud-builds-log',
        input: HookFixtureBuilder.bash('gcloud builds log 12345 --stream --region=us-central1'),
      });

      expectAllowed(result);
    });
  });

  describe('validate-gcloud-resources.sh', () => {
    it('blocks gsutil mb for bucket creation', () => {
      const result = executeHookSync({
        hookName: 'validate-gcloud-resources',
        input: HookFixtureBuilder.bash('gsutil mb gs://my-new-bucket'),
      });

      expectBlocked(result, {
        pattern: /BLOCKED/i,
        messageIncludes: 'Terraform',
      });
    });

    it('blocks gcloud run deploy', () => {
      const result = executeHookSync({
        hookName: 'validate-gcloud-resources',
        input: HookFixtureBuilder.bash('gcloud run deploy my-service --image=ghcr.io/image:latest'),
      });

      expectBlocked(result, {
        pattern: /BLOCKED/i,
        messageIncludes: 'Terraform',
      });
    });

    it('blocks gcloud pubsub topics create', () => {
      const result = executeHookSync({
        hookName: 'validate-gcloud-resources',
        input: HookFixtureBuilder.bash('gcloud pubsub topics create my-topic'),
      });

      expectBlocked(result, {
        pattern: /BLOCKED/i,
        messageIncludes: 'Terraform',
      });
    });

    it('allows gcloud builds submit (CI commands)', () => {
      const result = executeHookSync({
        hookName: 'validate-gcloud-resources',
        input: HookFixtureBuilder.bash('gcloud builds submit --pack image'),
      });

      expectAllowed(result);
    });
  });

  describe('validate-linear-state.sh', () => {
    it('blocks setting state to Done', () => {
      const result = executeHookSync({
        hookName: 'validate-linear-state',
        input: HookFixtureBuilder.linearUpdateIssue('INT-123', { state: 'Done' }),
      });

      expectBlocked(result, {
        pattern: /BLOCKED/i,
        messageIncludes: 'In Review',
      });
    });

    it('blocks setting state to QA', () => {
      const result = executeHookSync({
        hookName: 'validate-linear-state',
        input: HookFixtureBuilder.linearUpdateIssue('INT-123', { state: 'QA' }),
      });

      expectBlocked(result, {
        pattern: /BLOCKED/i,
      });
    });

    it('blocks setting state to Done by state ID', () => {
      const result = executeHookSync({
        hookName: 'validate-linear-state',
        input: HookFixtureBuilder.linearUpdateIssue('INT-123', {
          state: 'e95d5420-217a-4085-a8ea-3d01b4926e90',
        }),
      });

      expectBlocked(result, {
        pattern: /BLOCKED/i,
      });
    });

    it('blocks setting state to QA by state ID', () => {
      const result = executeHookSync({
        hookName: 'validate-linear-state',
        input: HookFixtureBuilder.linearUpdateIssue('INT-123', {
          state: '0834f4c6-ed6b-4992-8340-023648f472d6',
        }),
      });

      expectBlocked(result, {
        pattern: /BLOCKED/i,
      });
    });

    it('blocks linear-server variant setting Done', () => {
      const result = executeHookSync({
        hookName: 'validate-linear-state',
        input: HookFixtureBuilder.linearServerUpdateIssue('INT-123', { state: 'Done' }),
      });

      expectBlocked(result, {
        pattern: /BLOCKED/i,
      });
    });

    it('allows setting state to In Progress', () => {
      const result = executeHookSync({
        hookName: 'validate-linear-state',
        input: HookFixtureBuilder.linearUpdateIssue('INT-123', { state: 'In Progress' }),
      });

      expectAllowed(result);
    });

    it('allows setting state to In Review', () => {
      const result = executeHookSync({
        hookName: 'validate-linear-state',
        input: HookFixtureBuilder.linearUpdateIssue('INT-123', { state: 'In Review' }),
      });

      expectAllowed(result);
    });

    it('allows updates without state change', () => {
      const result = executeHookSync({
        hookName: 'validate-linear-state',
        input: HookFixtureBuilder.linearUpdateIssue('INT-123', { title: 'New title' }),
      });

      expectAllowed(result);
    });

    it('ignores non-Linear tools', () => {
      const result = executeHookSync({
        hookName: 'validate-linear-state',
        input: HookFixtureBuilder.bash('echo hello'),
      });

      expectAllowed(result);
    });

    it('blocks setting assignee on update_issue', () => {
      const result = executeHookSync({
        hookName: 'validate-linear-state',
        input: HookFixtureBuilder.linearUpdateIssue('INT-123', { assignee: 'me' }),
      });

      expectBlocked(result, {
        pattern: /BLOCKED/i,
        messageIncludes: 'assign',
      });
    });

    it('blocks setting assigneeId on update_issue', () => {
      const result = executeHookSync({
        hookName: 'validate-linear-state',
        input: HookFixtureBuilder.linearUpdateIssue('INT-123', { assigneeId: 'user-uuid' }),
      });

      expectBlocked(result, {
        pattern: /BLOCKED/i,
        messageIncludes: 'assign',
      });
    });

    it('blocks setting delegate on update_issue', () => {
      const result = executeHookSync({
        hookName: 'validate-linear-state',
        input: HookFixtureBuilder.linearUpdateIssue('INT-123', { delegate: 'agent-1' }),
      });

      expectBlocked(result, {
        pattern: /BLOCKED/i,
        messageIncludes: 'delegat',
      });
    });

    it('blocks setting assignee on save_issue', () => {
      const result = executeHookSync({
        hookName: 'validate-linear-state',
        input: HookFixtureBuilder.linearSaveIssue({ id: 'INT-123', assignee: 'me' }),
      });

      expectBlocked(result, {
        pattern: /BLOCKED/i,
        messageIncludes: 'assign',
      });
    });

    it('blocks setting delegate on save_issue', () => {
      const result = executeHookSync({
        hookName: 'validate-linear-state',
        input: HookFixtureBuilder.linearSaveIssue({ id: 'INT-123', delegate: 'agent-1' }),
      });

      expectBlocked(result, {
        pattern: /BLOCKED/i,
        messageIncludes: 'delegat',
      });
    });

    it('blocks setting state to Done on save_issue', () => {
      const result = executeHookSync({
        hookName: 'validate-linear-state',
        input: HookFixtureBuilder.linearSaveIssue({ id: 'INT-123', state: 'Done' }),
      });

      expectBlocked(result, {
        pattern: /BLOCKED/i,
        messageIncludes: 'Done',
      });
    });

    it('allows save_issue with valid state and no assignee', () => {
      const result = executeHookSync({
        hookName: 'validate-linear-state',
        input: HookFixtureBuilder.linearSaveIssue({ id: 'INT-123', state: 'In Progress' }),
      });

      expectAllowed(result);
    });

    it('allows save_issue with no state and no assignee', () => {
      const result = executeHookSync({
        hookName: 'validate-linear-state',
        input: HookFixtureBuilder.linearSaveIssue({ id: 'INT-123', title: 'Updated title' }),
      });

      expectAllowed(result);
    });
  });

  describe('validate-terraform.sh', () => {
    it('blocks terraform plan without cleared env vars in command', () => {
      const result = executeHookSync({
        hookName: 'validate-terraform',
        input: HookFixtureBuilder.bash('terraform plan'),
      });

      expectBlocked(result, {
        pattern: /BLOCKED/i,
        messageIncludes: 'emulator',
      });
    });

    it('allows terraform plan with FIRESTORE_EMULATOR_HOST= prefix in command', () => {
      const result = executeHookSync({
        hookName: 'validate-terraform',
        input: HookFixtureBuilder.bash('FIRESTORE_EMULATOR_HOST= terraform plan'),
      });

      expectAllowed(result);
    });

    it('allows terraform fmt (no emulator check needed)', () => {
      const result = executeHookSync({
        hookName: 'validate-terraform',
        input: HookFixtureBuilder.bash('terraform fmt -check -recursive'),
      });

      expectAllowed(result);
    });
  });
});
