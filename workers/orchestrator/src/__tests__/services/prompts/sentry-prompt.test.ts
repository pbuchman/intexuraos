import { afterEach, describe, expect, it } from 'vitest';
import { sentryPrompt } from '../../../services/prompts/sentry-prompt.js';
import type { SystemPromptParams } from '../../../services/prompts/prompt-shared.js';

const originalErrorHubHost = process.env['INTEXURAOS_ERROR_HUB_HOST'];

afterEach(() => {
  if (originalErrorHubHost === undefined) {
    delete process.env['INTEXURAOS_ERROR_HUB_HOST'];
  } else {
    process.env['INTEXURAOS_ERROR_HUB_HOST'] = originalErrorHubHost;
  }
});

describe('sentryPrompt evidence provider routing', () => {
  it('selects only the historical Sentry MCP for a sentry.io issue URL', () => {
    process.env['INTEXURAOS_ERROR_HUB_HOST'] = 'home-dev.example.ts.net:8443';

    const prompt = sentryPrompt.build(buildParams('https://intexura.sentry.io/issues/123456/'));

    expect(prompt).toContain('Selected evidence MCP: `sentry`');
    expect(prompt).toContain('Use only the `sentry` MCP for this task.');
    expect(prompt).not.toContain('Use only the `error_hub` MCP for this task.');
  });

  it('selects only the Error Hub MCP when the issue URL matches the configured host', () => {
    process.env['INTEXURAOS_ERROR_HUB_HOST'] = 'home-dev.example.ts.net:8443';

    const prompt = sentryPrompt.build(
      buildParams('https://home-dev.example.ts.net:8443/organizations/intexuraos/issues/1042/')
    );

    expect(prompt).toContain('Selected evidence MCP: `error_hub`');
    expect(prompt).toContain('Use only the `error_hub` MCP for this task.');
    expect(prompt).not.toContain('Use only the `sentry` MCP for this task.');
    expect(prompt).toContain('GET /api/0/organizations/{org}/issues/{issueId}/');
    expect(prompt).toContain('GET /api/0/organizations/{org}/issues/{issueId}/events/latest/');
    expect(prompt).toContain('GET /api/0/organizations/{org}/issues/{issueId}/events/{eventId}/');
    expect(prompt).toContain('GET /api/0/organizations/{org}/issues/{issueId}/events/');
    expect(prompt).toContain('GET /api/0/projects/{org}/{projectSlugOrId}/');
    expect(prompt).toContain('network reachability is the access boundary');
  });

  it('does not route an unknown non-Sentry host to either MCP', () => {
    process.env['INTEXURAOS_ERROR_HUB_HOST'] = 'home-dev.example.ts.net:8443';

    const prompt = sentryPrompt.build(
      buildParams('https://untrusted.example.test/organizations/intexuraos/issues/1042/')
    );

    expect(prompt).toContain('Selected evidence MCP: none');
    expect(prompt).toContain('Do not query either evidence MCP');
  });

  it('keeps the completion contract unchanged', () => {
    process.env['INTEXURAOS_ERROR_HUB_HOST'] = 'home-dev.example.ts.net:8443';

    const prompt = sentryPrompt.build(
      buildParams('https://home-dev.example.ts.net:8443/organizations/intexuraos/issues/1042/')
    );

    expect(prompt).toContain(`SENTRY_AGENT_FINAL:
- outcome: <fixed|suppressed|failed>
- pr: <GitHub PR URL>
- sentry_issue: <Sentry issue URL>
- linear_issue: <Linear issue URL>
- verification: <commands run and result>
- reproduction: <attempted reproduction evidence, or why reproduction was not feasible>
- suppression_rationale: <required when outcome=suppressed, otherwise n/a>
- failure_reason: <short structured reason when outcome=failed, otherwise n/a>
- summary: <concise bullet-point list, max 5-6 points>`);
  });
});

function buildParams(issueUrl: string): SystemPromptParams {
  return {
    taskId: 'task_sentry',
    linearIssueId: 'INT-200',
    linearIssueTitle: 'Fix captured exception',
    linearIssueLabels: ['bug', 'sentry'],
    workerType: 'codex-xhigh',
    agentType: 'sentry',
    sentryIssue: {
      organizationSlug: 'intexuraos',
      projectSlug: 'intexuraos-backend',
      projectId: '1',
      issueId: '1042',
      issueShortId: 'INTEXURA-HUB-1042',
      issueUrl,
      title: 'TypeError: Cannot read properties of undefined',
      action: 'triggered',
      eventId: '4f7a4f2c0e8e4c2a9c3d5e7f90123456',
      receivedAt: '2026-07-28T12:00:00.000Z',
    },
  };
}
