import { spawn, spawnSync } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildDockerArguments,
  parseErrorHubMcpEntry,
  parseVerificationConfiguration,
  validateMcpEvidence,
} from '../../../../scripts/verify-error-hub-mcp.mjs';

const EVENT_ID = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const IMAGE = `registry.example/code-worker@sha256:${'b'.repeat(64)}`;
const ISSUE_URL = 'https://home-dev.example.ts.net:8443/organizations/intexuraos/issues/42/';
const CONNECT_ADDRESS = 'fd00:172:28::1';
const INITIALIZE_RESULT = {
  protocolVersion: '2025-06-18',
  capabilities: { tools: {} },
  serverInfo: { name: 'Sentry MCP', version: '0.37.0' },
};

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
      mode: 'acceptance',
    });
  });

  it('accepts a canonical issue without a pinned event ID in probe mode', () => {
    expect(parseVerificationConfiguration(['--probe', ISSUE_URL], validEnvironment())).toEqual({
      host: 'home-dev.example.ts.net:8443',
      image: IMAGE,
      issueId: '42',
      issueUrl: ISSUE_URL,
      mode: 'probe',
    });
  });

  it('accepts transport-only mode without a fabricated issue or event', () => {
    expect(parseVerificationConfiguration(['--transport-only'], validEnvironment())).toEqual({
      host: 'home-dev.example.ts.net:8443',
      image: IMAGE,
      mode: 'transport-only',
    });
  });

  it('rejects user-provided bridge addresses other than the configured gateway', () => {
    expect(() =>
      parseVerificationConfiguration(['--probe', ISSUE_URL], {
        ...validEnvironment(),
        INTEXURAOS_ERROR_HUB_CONNECT_ADDRESS: 'fd00:172:28::2',
      })
    ).toThrow(/INTEXURAOS_ERROR_HUB_CONNECT_ADDRESS/);
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
      '--pull=never',
      '--name',
      'error-hub-mcp-verifier-test',
      '--label',
      'com.intexuraos.error-hub-probe=error-hub-mcp-verifier-test',
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

  it('sets a DNS-only hostname override while leaving the HTTPS origin intact', () => {
    const config = parseVerificationConfiguration(['--transport-only'], {
      ...validEnvironment(),
      INTEXURAOS_ERROR_HUB_CONNECT_ADDRESS: CONNECT_ADDRESS,
    });
    const args = buildDockerArguments(config, 'error-hub-mcp-verifier-test');

    expect(args.slice(args.indexOf('--add-host'), args.indexOf('--add-host') + 2)).toEqual([
      '--add-host',
      `home-dev.example.ts.net=${CONNECT_ADDRESS}`,
    ]);
    expect(args).toContain('ERROR_HUB_HOST=home-dev.example.ts.net:8443');
    expect(args).not.toContainEqual(expect.stringMatching(/CONNECT_ADDRESS/u));
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

describe('verifier CLI', () => {
  const script = fileURLToPath(
    new URL('../../../../scripts/verify-error-hub-mcp.mjs', import.meta.url)
  );
  const fixture = readFileSync(
    new URL('./fixtures/error-hub-mcp-docker.mjs', import.meta.url),
    'utf8'
  );
  const temporaryDirectories: string[] = [];

  function prepareDocker(scenario: string): { log: string; env: NodeJS.ProcessEnv } {
    const directory = mkdtempSync(join(tmpdir(), 'error-hub-probe-cli-'));
    temporaryDirectories.push(directory);
    const docker = join(directory, 'docker');
    const log = join(directory, 'docker.log');
    writeFileSync(docker, `#!${process.execPath}\n${fixture}`, { mode: 0o700 });
    writeFileSync(log, '');
    return {
      log,
      env: {
        ...validEnvironment(),
        PATH: `${directory}:${process.env['PATH'] ?? ''}`,
        FAKE_DOCKER_LOG: log,
        FAKE_DOCKER_STATE: join(directory, 'state'),
        FAKE_DOCKER_SCENARIO: scenario,
      },
    };
  }

  afterEach(() => {
    for (const path of temporaryDirectories.splice(0))
      rmSync(path, { force: true, recursive: true });
  });

  it.each([
    { mode: 'acceptance', args: [ISSUE_URL, EVENT_ID] },
    { mode: 'probe', args: ['--probe', ISSUE_URL] },
  ])(
    'reads current issue evidence in $mode mode with no raw payload or IDs in output',
    ({ mode, args }) => {
      const { env, log } = prepareDocker(
        mode === 'probe' ? 'issue-without-optional-metadata' : 'business-read'
      );
      const result = spawnSync(process.execPath, [script, ...args], {
        env,
        encoding: 'utf8',
        timeout: 4_000,
      });

      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      expect(JSON.parse(result.stdout)).toEqual({
        ok: true,
        mode,
        transportReady: true,
        businessAccess: true,
        mcpName: 'Sentry MCP',
        mcpVersion: '0.37.0',
      });
      const calls = readFileSync(log, 'utf8');
      expect(calls).toContain('get_issue_details');
      expect(calls).toContain('search_issue_events');
    }
  );

  it('verifies HTTPS readiness and lists MCP tools in an empty store without reading issues', () => {
    const { env, log } = prepareDocker('empty');
    const result = spawnSync(process.execPath, [script, '--transport-only'], {
      env,
      encoding: 'utf8',
      timeout: 4_000,
    });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      ok: true,
      mode: 'transport-only',
      transportReady: true,
      businessAccess: false,
      mcpName: 'Sentry MCP',
      mcpVersion: '0.37.0',
    });
    const calls = readFileSync(log, 'utf8');
    expect(calls).toContain('https://home-dev.example.ts.net:8443/health/ready');
    expect(calls).toContain('tools/list');
    expect(calls).not.toContain('tools/call');
    expect(calls).not.toContain('NODE_TLS_REJECT_UNAUTHORIZED');
  });

  it('requires the pinned event in strict mode even when other current evidence exists', () => {
    const { env } = prepareDocker('business-read');
    const result = spawnSync(process.execPath, [script, ISSUE_URL, 'b'.repeat(32)], {
      env,
      encoding: 'utf8',
      timeout: 4_000,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toEqual({
      ok: false,
      mode: 'acceptance',
      error: 'business_evidence_failed',
    });
  });

  it.each(['newer-event', 'original-outside-recent-page'])(
    'reads the retained original event by ID with %s',
    (scenario) => {
      const { env, log } = prepareDocker(scenario);
      const result = spawnSync(process.execPath, [script, ISSUE_URL, EVENT_ID], {
        env,
        encoding: 'utf8',
        timeout: 4_000,
      });
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, businessAccess: true });
      const calls = readFileSync(log, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(calls).toContainEqual([
        'mcp',
        'tools/call',
        {
          name: 'get_issue_details',
          arguments: { organizationSlug: 'intexuraos', issueId: '42', eventId: EVENT_ID },
        },
      ]);
    }
  );

  it('keeps probe mode on the current event when an older event remains readable', () => {
    const { env, log } = prepareDocker('newer-event');
    const result = spawnSync(process.execPath, [script, '--probe', ISSUE_URL], {
      env,
      encoding: 'utf8',
      timeout: 4_000,
    });
    expect(result.status).toBe(0);
    const calls = readFileSync(log, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(calls).toContainEqual([
      'mcp',
      'tools/call',
      {
        name: 'get_issue_details',
        arguments: { issueUrl: ISSUE_URL },
      },
    ]);
  });

  it.each([
    'missing-protocol',
    'unsupported-protocol',
    'missing-capabilities',
    'missing-tools',
    'invalid-tools',
    'invalid-tool-list-changed',
  ])('rejects %s before using MCP tools and cleans its container', (scenario) => {
    const { env, log } = prepareDocker(scenario);
    const result = spawnSync(process.execPath, [script, '--transport-only'], {
      env,
      encoding: 'utf8',
      timeout: 4_000,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toEqual({
      ok: false,
      mode: 'transport-only',
      error: 'mcp_transport_failed',
    });
    const calls = readFileSync(log, 'utf8');
    expect(calls).not.toContain('notifications/initialized');
    expect(calls).not.toContain('tools/list');
    expect(calls).toContain(`["rm","--force","${'d'.repeat(64)}"]`);
  });

  it.each([
    {
      scenario: 'tls-failure',
      args: ['--transport-only'],
      mode: 'transport-only',
      error: 'https_readiness_failed',
    },
    {
      scenario: 'issue-gone',
      args: ['--probe', ISSUE_URL],
      mode: 'probe',
      error: 'issue_not_found',
    },
    {
      scenario: 'foreign-label',
      args: ['--transport-only'],
      mode: 'transport-only',
      error: 'cleanup_failed',
    },
  ])('reports a fixed sanitized category for $scenario', ({ scenario, args, mode, error }) => {
    const { env, log } = prepareDocker(scenario);
    const result = spawnSync(process.execPath, [script, ...args], {
      env,
      encoding: 'utf8',
      timeout: 4_000,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toEqual({ ok: false, mode, error });
    if (scenario === 'foreign-label') expect(readFileSync(log, 'utf8')).not.toContain('["rm"');
  });

  it('kills a hung Docker read on termination and removes only the label-verified container', async () => {
    const { env, log } = prepareDocker('hold-readiness');
    const output = join(log, '..', 'output');
    const fd = openSync(output, 'w');
    const child = spawn(process.execPath, [script, '--transport-only'], {
      env,
      stdio: ['ignore', fd, fd],
    });
    closeSync(fd);
    const status = new Promise<number | null>((resolve) => child.once('close', resolve));
    try {
      await vi.waitFor(() => expect(readFileSync(log, 'utf8')).toContain('/health/ready'), {
        timeout: 2_000,
      });
      child.kill('SIGTERM');
      expect(await status).toBe(1);
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await status;
    }

    expect(JSON.parse(readFileSync(output, 'utf8'))).toEqual({
      ok: false,
      mode: 'transport-only',
      error: 'interrupted',
    });
    const calls = readFileSync(log, 'utf8');
    expect(calls).toContain('com.intexuraos.error-hub-probe');
    expect(calls).toContain(`["rm","--force","${'d'.repeat(64)}"]`);
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
        initializeResult: INITIALIZE_RESULT,
        searchResult: {
          content: [{ type: 'text', text: `Found 1 error\n**eventID**: ${EVENT_ID}` }],
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

  it.each(['2025-06-18', '2025-03-26', '2024-11-05'])(
    'accepts negotiated protocol %s supported by the pinned client',
    (protocolVersion) => {
      expect(
        validateMcpEvidence({
          initializeResult: { ...INITIALIZE_RESULT, protocolVersion },
          detailsResult: { content: [{ type: 'text', text: detailsText }] },
          expectedEventId: EVENT_ID,
          searchResult: { content: [{ type: 'text', text: `**eventID**: ${'c'.repeat(32)}` }] },
        })
      ).toMatchObject({ eventId: EVENT_ID, mcpVersion: '0.37.0' });
    }
  );

  it.each([
    {
      name: 'different MCP build',
      initializeResult: {
        ...INITIALIZE_RESULT,
        serverInfo: { name: 'Sentry MCP', version: '0.38.0' },
      },
      detailsResult: { content: [{ type: 'text', text: detailsText }] },
      searchResult: { content: [{ type: 'text', text: `**eventID**: ${EVENT_ID}` }] },
    },
    {
      name: 'missing stack',
      initializeResult: INITIALIZE_RESULT,
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
      searchResult: { content: [{ type: 'text', text: `**eventID**: ${EVENT_ID}` }] },
    },
    {
      name: 'missing recent event IDs',
      initializeResult: INITIALIZE_RESULT,
      detailsResult: { content: [{ type: 'text', text: detailsText }] },
      searchResult: { content: [{ type: 'text', text: 'Found 0 errors' }] },
    },
    {
      name: 'event ID appears in a search result message only',
      initializeResult: INITIALIZE_RESULT,
      detailsResult: { content: [{ type: 'text', text: detailsText }] },
      searchResult: {
        content: [
          {
            type: 'text',
            text: `**message**: linked event ${EVENT_ID}`,
          },
        ],
      },
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
