import { appendFileSync, existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import process from 'node:process';

const [, , ...args] = process.argv;
const statePath = process.env.FAKE_DOCKER_STATE;
const scenario = process.env.FAKE_DOCKER_SCENARIO;
const sentinel = 'do-not-publish-private-evidence';
const containerId = 'd'.repeat(64);
const eventId = 'a'.repeat(32);
const newerEventId = 'c'.repeat(32);
appendFileSync(process.env.FAKE_DOCKER_LOG, `${JSON.stringify(args)}\n`);

if (args[0] === 'run') {
  writeFileSync(statePath, args[args.indexOf('--label') + 1]);
  console.log(containerId);
} else if (args[0] === 'ps') {
  if (existsSync(statePath)) console.log(containerId);
} else if (args[0] === 'inspect') {
  if (scenario === 'auto-remove-before-inspect') {
    unlinkSync(statePath);
    process.exit(1);
  }
  const label =
    scenario === 'foreign-label'
      ? 'com.intexuraos.error-hub-probe=other-invocation'
      : readFileSync(statePath, 'utf8');
  console.log(`${containerId} ${label.split('=')[1]}`);
} else if (args[0] === 'rm') {
  if (scenario === 'issue-gone-auto-remove-before-rm') {
    unlinkSync(statePath);
    process.exit(1);
  }
  if (scenario === 'rm-failure') process.exit(1);
} else if (args[2] === 'test') {
  // The disposable container exists and has completed its managed boot.
} else if (args[2] === 'node') {
  if (scenario === 'hold-readiness') {
    setTimeout(() => process.exit(1), 2_000);
  } else if (scenario === 'tls-failure') {
    console.error(sentinel);
    process.exit(1);
  } else {
    console.log(
      scenario.startsWith('issue-gone') &&
        args.at(-1).startsWith('https://') &&
        new URL(args.at(-1)).pathname.startsWith('/api/0/')
        ? '404'
        : '200'
    );
  }
} else if (args[2] === 'codex') {
  console.log(
    JSON.stringify({
      name: 'error_hub',
      enabled: true,
      disabled_reason: null,
      transport: {
        type: 'stdio',
        command: 'sh',
        args: [
          '-lc',
          'exec sentry-mcp --access-token tailnet-only --host "$ERROR_HUB_HOST" --disable-skills=seer',
        ],
        env: null,
        env_vars: ['ERROR_HUB_HOST'],
        cwd: null,
      },
    })
  );
} else if (args[1] === '--interactive') {
  for await (const line of createInterface({ input: process.stdin })) {
    const message = JSON.parse(line);
    appendFileSync(
      process.env.FAKE_DOCKER_LOG,
      `${JSON.stringify(['mcp', message.method, message.params.arguments])}\n`
    );
    if (message.id === undefined) continue;
    const tool = message.params.arguments?.name;
    const toolArgs = message.params.arguments?.arguments;
    const hasNewerEvent = ['newer-event', 'original-outside-recent-page'].includes(scenario);
    const selectedEventId = hasNewerEvent && toolArgs?.eventId !== eventId ? newerEventId : eventId;
    const initialize = {
      protocolVersion: '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: 'Sentry MCP', version: '0.37.0' },
    };
    if (scenario === 'missing-protocol') delete initialize.protocolVersion;
    if (scenario === 'unsupported-protocol') initialize.protocolVersion = '1900-01-01';
    if (scenario === 'missing-capabilities') delete initialize.capabilities;
    if (scenario === 'missing-tools') initialize.capabilities = {};
    if (scenario === 'invalid-tools') initialize.capabilities.tools = [];
    if (scenario === 'invalid-tool-list-changed')
      initialize.capabilities.tools = { listChanged: 'yes' };
    const result = {
      initialize,
      'tools/list': { tools: [{ name: 'execute_sentry_tool' }] },
      'tools/call': {
        content: [
          {
            type: 'text',
            text:
              tool === 'get_issue_details'
                ? scenario === 'issue-without-optional-metadata'
                  ? `**Event ID**: ${selectedEventId}`
                  : [
                      `**Event ID**: ${selectedEventId}`,
                      `**Description**: ${sentinel}`,
                      '**Project**: fixture',
                      '**environment**: dev',
                      '**release**: fixture',
                      '**Stacktrace:**',
                      '```',
                      'at privatePath()',
                      '```',
                    ].join('\n')
                : scenario === 'original-outside-recent-page'
                  ? `Found one event\n**eventID**: ${newerEventId}`
                  : `Found events\n**eventID**: ${eventId}${hasNewerEvent ? `\n**eventID**: ${newerEventId}` : ''}`,
          },
        ],
      },
    }[message.method];
    console.log(
      JSON.stringify({
        jsonrpc: '2.0',
        id: message.id,
        ...(scenario.startsWith('issue-gone') && tool !== undefined
          ? { error: { code: -32000, message: sentinel } }
          : { result }),
      })
    );
  }
} else {
  console.error(sentinel);
  process.exit(1);
}
