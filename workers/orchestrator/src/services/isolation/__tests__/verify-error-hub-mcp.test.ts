import { describe, expect, it } from 'vitest';
import {
  buildDockerArguments,
  parseErrorHubMcpEntry,
  parseVerificationConfiguration,
  validateMcpEvidence,
} from '../../../../scripts/verify-error-hub-mcp.mjs';

const EVENT_ID = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const IMAGE = `registry.example/code-worker@sha256:${'b'.repeat(64)}`;
const ISSUE_URL = 'https://home-dev.example.ts.net:8443/organizations/intexuraos/issues/42/';

function validEnvironment(): Record<string, string> {
  return {
    INTEXURAOS_CODE_WORKER_IMAGE: IMAGE,
    INTEXURAOS_ERROR_HUB_HOST: 'home-dev.example.ts.net:8443',
  };
}

describe('parseVerificationConfiguration', () => {
  it('accepts only a canonical private issue URL, event id, host, and immutable worker image', () => {
    expect(parseVerificationConfiguration([ISSUE_URL, EVENT_ID], validEnvironment())).toEqual({
      eventId: EVENT_ID,
      host: 'home-dev.example.ts.net:8443',
      image: IMAGE,
      issueId: '42',
      issueUrl: ISSUE_URL,
    });
  });

  it.each([
    {
      name: 'extra command argument',
      argv: [ISSUE_URL, EVENT_ID, 'sh'],
      env: validEnvironment(),
    },
    {
      name: 'plain HTTP issue URL',
      argv: [ISSUE_URL.replace('https:', 'http:'), EVENT_ID],
      env: validEnvironment(),
    },
    {
      name: 'different issue host',
      argv: [ISSUE_URL.replace('home-dev', 'other'), EVENT_ID],
      env: validEnvironment(),
    },
    {
      name: 'issue URL query',
      argv: [`${ISSUE_URL}?redirect=sentry.io`, EVENT_ID],
      env: validEnvironment(),
    },
    {
      name: 'non-issue URL path',
      argv: [ISSUE_URL.replace('/issues/42/', '/issues/42/delete/'), EVENT_ID],
      env: validEnvironment(),
    },
    {
      name: 'malformed event id',
      argv: [ISSUE_URL, 'not-an-event-id'],
      env: validEnvironment(),
    },
    {
      name: 'mutable worker image',
      argv: [ISSUE_URL, EVENT_ID],
      env: {
        ...validEnvironment(),
        INTEXURAOS_CODE_WORKER_IMAGE: 'registry.example/code-worker:latest',
      },
    },
    {
      name: 'Docker option in place of an image',
      argv: [ISSUE_URL, EVENT_ID],
      env: {
        ...validEnvironment(),
        INTEXURAOS_CODE_WORKER_IMAGE: `--network=host@sha256:${'b'.repeat(64)}`,
      },
    },
    {
      name: 'non-tailnet host',
      argv: [ISSUE_URL, EVENT_ID],
      env: {
        ...validEnvironment(),
        INTEXURAOS_ERROR_HUB_HOST: 'errors.intexuraos.cloud:8443',
      },
    },
    ...[
      '.ts.net:8443',
      'foo..ts.net:8443',
      '_x.example.ts.net:8443',
      '-host.example.ts.net:8443',
      'host-.example.ts.net:8443',
    ].map((host) => ({
      name: `invalid tailnet DNS host ${host}`,
      argv: [`https://${host}/organizations/intexuraos/issues/42/`, EVENT_ID],
      env: {
        ...validEnvironment(),
        INTEXURAOS_ERROR_HUB_HOST: host,
      },
    })),
  ])('rejects $name before Docker starts', ({ argv, env }) => {
    expect(() => parseVerificationConfiguration(argv, env)).toThrow();
  });
});

describe('buildDockerArguments', () => {
  it('boots one disposable managed Code Worker on the real network without overriding entrypoint', () => {
    const config = parseVerificationConfiguration([ISSUE_URL, EVENT_ID], validEnvironment());

    const args = buildDockerArguments(config, 'error-hub-mcp-verifier-test');

    expect(args).toEqual([
      'run',
      '--rm',
      '--detach',
      '--name',
      'error-hub-mcp-verifier-test',
      '--network',
      'code-worker-net',
      '--read-only',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges:true',
      '--pids-limit',
      '128',
      '--memory',
      '512m',
      '--tmpfs',
      '/tmp:size=64m,mode=1777',
      '--tmpfs',
      '/home/claude:size=64m,mode=1777,uid=1001,gid=1001',
      '--tmpfs',
      '/repo:size=16m,mode=0755,uid=1001,gid=1001',
      '--env',
      'WORKER_MANAGED_MODE=1',
      '--env',
      'ERROR_HUB_HOST=home-dev.example.ts.net:8443',
      IMAGE,
    ]);
    expect(args).not.toContain('--entrypoint');
    expect(args).not.toContain('--insecure-http');
    expect(args).not.toContain(ISSUE_URL);
    expect(args).not.toContain(EVENT_ID);
  });
});

describe('parseErrorHubMcpEntry', () => {
  const expectedCommand =
    'exec sentry-mcp --access-token tailnet-only --host "$ERROR_HUB_HOST" --disable-skills=seer';
  const validEntry = {
    name: 'error_hub',
    enabled: true,
    disabled_reason: null,
    transport: {
      type: 'stdio',
      command: 'sh',
      args: ['-lc', expectedCommand],
      env: null,
      env_vars: ['ERROR_HUB_HOST'],
      cwd: null,
    },
  };

  it('accepts only the restored Code Worker error_hub entry', () => {
    expect(parseErrorHubMcpEntry(JSON.stringify(validEntry))).toEqual({
      args: ['-lc', expectedCommand],
      command: 'sh',
    });
  });

  it.each([
    { name: 'different entry', entry: { ...validEntry, name: 'sentry' } },
    { name: 'disabled entry', entry: { ...validEntry, enabled: false } },
    {
      name: 'different executable',
      entry: { ...validEntry, transport: { ...validEntry.transport, command: 'bash' } },
    },
    {
      name: 'different arguments',
      entry: {
        ...validEntry,
        transport: { ...validEntry.transport, args: ['-lc', 'exec sentry-mcp --insecure-http'] },
      },
    },
    {
      name: 'injected environment',
      entry: { ...validEntry, transport: { ...validEntry.transport, env: { TOKEN: 'secret' } } },
    },
    {
      name: 'missing ERROR_HUB_HOST forwarding',
      entry: { ...validEntry, transport: { ...validEntry.transport, env_vars: [] } },
    },
    {
      name: 'different environment forwarding',
      entry: {
        ...validEntry,
        transport: { ...validEntry.transport, env_vars: ['SENTRY_AUTH_TOKEN'] },
      },
    },
    {
      name: 'additional environment forwarding',
      entry: {
        ...validEntry,
        transport: {
          ...validEntry.transport,
          env_vars: ['ERROR_HUB_HOST', 'SENTRY_AUTH_TOKEN'],
        },
      },
    },
  ])('rejects $name', ({ entry }) => {
    expect(() => parseErrorHubMcpEntry(JSON.stringify(entry))).toThrow();
  });
});

describe('validateMcpEvidence', () => {
  const detailsText = `# Issue INTEXURA-HUB-42 in **intexuraos**

**Description**: Controlled SentryBox validation fault
**Project**: IntexuraOS Backend

## Event Details

**Event ID**: ${EVENT_ID}

### Error

**Stacktrace:**
\`\`\`
    at emitControlledIssue (scripts/acceptance/emit-controlled-issue.mjs:1:1)
\`\`\`

### Tags

**environment**: dev
**release**: intexuraos-sentrybox-acceptance@1.0.0
`;

  it('requires version 0.37.0 and evidence from both read-only tools', () => {
    expect(
      validateMcpEvidence({
        detailsResult: {
          content: [{ type: 'text', text: detailsText }],
        },
        expectedEventId: EVENT_ID,
        initializeResult: {
          serverInfo: { name: 'Sentry MCP', version: '0.37.0' },
        },
        searchResult: {
          content: [{ type: 'text', text: `Found 1 error\n${EVENT_ID}` }],
        },
      })
    ).toEqual({
      environment: 'dev',
      eventId: EVENT_ID,
      mcpName: 'Sentry MCP',
      mcpVersion: '0.37.0',
      project: 'IntexuraOS Backend',
      release: 'intexuraos-sentrybox-acceptance@1.0.0',
      stack: 'at emitControlledIssue (scripts/acceptance/emit-controlled-issue.mjs:1:1)',
      title: 'Controlled SentryBox validation fault',
      tools: ['get_issue_details', 'search_issue_events'],
    });
  });

  it.each([
    {
      name: 'different MCP build',
      initializeResult: { serverInfo: { name: 'Sentry MCP', version: '0.38.0' } },
      detailsResult: { content: [{ type: 'text', text: detailsText }] },
      searchResult: { content: [{ type: 'text', text: EVENT_ID }] },
    },
    {
      name: 'missing stack',
      initializeResult: { serverInfo: { name: 'Sentry MCP', version: '0.37.0' } },
      detailsResult: {
        content: [
          {
            type: 'text',
            text: detailsText.replace(
              'at emitControlledIssue',
              'No stacktrace available\nat emitControlledIssue'
            ),
          },
        ],
      },
      searchResult: { content: [{ type: 'text', text: EVENT_ID }] },
    },
    {
      name: 'event absent from issue search',
      initializeResult: { serverInfo: { name: 'Sentry MCP', version: '0.37.0' } },
      detailsResult: { content: [{ type: 'text', text: detailsText }] },
      searchResult: { content: [{ type: 'text', text: 'Found 0 errors' }] },
    },
  ])('rejects $name', ({ initializeResult, detailsResult, searchResult }) => {
    expect(() =>
      validateMcpEvidence({
        detailsResult,
        expectedEventId: EVENT_ID,
        initializeResult,
        searchResult,
      })
    ).toThrow();
  });
});
