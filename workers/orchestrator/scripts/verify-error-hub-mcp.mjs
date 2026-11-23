import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import {
  getErrorHubHostMapping,
  validateErrorHubConnectAddress,
  validateErrorHubHost,
} from '../shared/error-hub-routing.mjs';

const EXPECTED_MCP_NAME = 'Sentry MCP';
const EXPECTED_MCP_VERSION = '0.37.0';
const MCP_PROTOCOL_VERSION = '2025-06-18';
const SUPPORTED_MCP_PROTOCOL_VERSIONS = [MCP_PROTOCOL_VERSION, '2025-03-26', '2024-11-05'];
const ORGANIZATION_SLUG = 'intexuraos';
const WORKER_NETWORK = 'code-worker-net';
const VERIFICATION_TIMEOUT_MS = 65_000;
const WORKER_READY_TIMEOUT_MS = 30_000;
const CLEANUP_TIMEOUT_MS = 4_000;
const PROBE_LABEL = 'com.intexuraos.error-hub-probe';
const ERROR_HUB_MCP_COMMAND = 'sh';
const ERROR_HUB_MCP_ARGUMENTS = [
  '-lc',
  'exec sentry-mcp --access-token tailnet-only --host "$ERROR_HUB_HOST" --disable-skills=seer',
];
const ERROR_HUB_MCP_ENVIRONMENT_VARIABLES = ['ERROR_HUB_HOST'];
const IMMUTABLE_IMAGE_PATTERN =
  /^(?:sha256:[a-f0-9]{64}|[a-z0-9][a-z0-9._:/-]*@sha256:[a-f0-9]{64})$/u;
const EVENT_ID_PATTERN = /^[a-f0-9]{32}$/u;

export function parseVerificationConfiguration(argv, environment) {
  const transportOnly = argv[0] === '--transport-only';
  if (argv.length !== (transportOnly ? 1 : 2)) {
    throw new TypeError(
      'usage: verify:error-hub-mcp <private issue URL> <event ID> | --probe <private issue URL> | --transport-only'
    );
  }

  const host = requiredEnvironment(environment, 'INTEXURAOS_ERROR_HUB_HOST');
  validateErrorHubHost(host);
  const connectAddress = validateErrorHubConnectAddress(
    environment.INTEXURAOS_ERROR_HUB_CONNECT_ADDRESS
  );
  const image = requiredEnvironment(environment, 'INTEXURAOS_CODE_WORKER_IMAGE');
  if (!IMMUTABLE_IMAGE_PATTERN.test(image)) {
    throw new TypeError('INTEXURAOS_CODE_WORKER_IMAGE must be an immutable sha256 image reference');
  }
  const route = { host, image, ...(connectAddress !== undefined && { connectAddress }) };
  if (transportOnly) return { ...route, mode: 'transport-only' };

  const probe = argv[0] === '--probe';
  const issueUrlText = requiredString(probe ? argv[1] : argv[0], 'private issue URL');
  const eventId = probe ? undefined : requiredString(argv[1], 'event ID');
  if (eventId !== undefined && !EVENT_ID_PATTERN.test(eventId)) {
    throw new TypeError('event ID must be exactly 32 lowercase hexadecimal characters');
  }

  let issueUrl;
  try {
    issueUrl = new URL(issueUrlText);
  } catch {
    throw new TypeError('private issue URL is not a URL');
  }
  const issueMatch = issueUrl.pathname.match(
    new RegExp(`^/organizations/${ORGANIZATION_SLUG}/issues/([1-9]\\d*)/$`, 'u')
  );
  if (
    issueUrl.protocol !== 'https:' ||
    issueUrl.username !== '' ||
    issueUrl.password !== '' ||
    issueUrl.host.toLowerCase() !== host.toLowerCase() ||
    issueUrl.search !== '' ||
    issueUrl.hash !== '' ||
    issueUrl.toString() !== issueUrlText ||
    issueMatch === null
  ) {
    throw new TypeError(
      'private issue URL must be the canonical HTTPS SentryBox issue URL for the configured host'
    );
  }

  return {
    ...route,
    mode: probe ? 'probe' : 'acceptance',
    ...(eventId !== undefined && { eventId }),
    issueId: issueMatch[1],
    issueUrl: issueUrlText,
  };
}

export function buildDockerArguments(config, containerName) {
  requiredString(containerName, 'container name');
  const mapping = getErrorHubHostMapping(config.host, config.connectAddress);
  return [
    'run',
    '--rm',
    '--detach',
    '--pull=never',
    '--name',
    containerName,
    '--label',
    `${PROBE_LABEL}=${containerName}`,
    '--network',
    WORKER_NETWORK,
    ...(mapping === undefined ? [] : ['--add-host', `${mapping.hostname}=${mapping.address}`]),
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
    `ERROR_HUB_HOST=${config.host}`,
    config.image,
  ];
}

export function parseErrorHubMcpEntry(jsonText) {
  const text = requiredString(jsonText, 'error_hub MCP entry');
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new TypeError('error_hub MCP entry must be valid JSON');
  }

  const entry = record(parsed, 'error_hub MCP entry');
  const transport = record(entry.transport, 'error_hub MCP transport');
  const args = array(transport.args, 'error_hub MCP arguments');
  const envVars = array(transport.env_vars, 'error_hub MCP environment variables');
  if (
    entry.name !== 'error_hub' ||
    entry.enabled !== true ||
    entry.disabled_reason !== null ||
    transport.type !== 'stdio' ||
    transport.command !== ERROR_HUB_MCP_COMMAND ||
    args.length !== ERROR_HUB_MCP_ARGUMENTS.length ||
    !args.every((argument, index) => argument === ERROR_HUB_MCP_ARGUMENTS[index]) ||
    transport.env !== null ||
    envVars.length !== ERROR_HUB_MCP_ENVIRONMENT_VARIABLES.length ||
    !envVars.every(
      (environmentVariable, index) =>
        environmentVariable === ERROR_HUB_MCP_ENVIRONMENT_VARIABLES[index]
    ) ||
    transport.cwd !== null
  ) {
    throw new Error('Code Worker error_hub MCP entry does not match the pinned runtime contract');
  }

  return {
    args: [...ERROR_HUB_MCP_ARGUMENTS],
    command: ERROR_HUB_MCP_COMMAND,
  };
}

function validateMcpServer(initializeResult) {
  const initialize = record(initializeResult, 'MCP initialize result');
  if (!SUPPORTED_MCP_PROTOCOL_VERSIONS.includes(initialize.protocolVersion)) {
    throw new Error('Sentry MCP negotiated an unsupported protocol version');
  }
  const capabilities = record(initialize.capabilities, 'MCP capabilities');
  const tools = record(capabilities.tools, 'MCP tools capability');
  if (tools.listChanged !== undefined && typeof tools.listChanged !== 'boolean') {
    throw new Error('Sentry MCP returned an invalid tools capability');
  }
  const serverInfo = record(initialize.serverInfo, 'MCP serverInfo');
  if (serverInfo.name !== EXPECTED_MCP_NAME || serverInfo.version !== EXPECTED_MCP_VERSION) {
    throw new Error('Sentry MCP identity does not match the pinned worker image contract');
  }
  return { mcpName: EXPECTED_MCP_NAME, mcpVersion: EXPECTED_MCP_VERSION };
}

function validateEventSearch(searchResult, eventId) {
  const searchText = toolText(searchResult, 'search_issue_events');
  // The pinned client renders the SentryBox eventID as a field in each row.
  const eventIds = [...searchText.matchAll(/^\*\*eventID\*\*: ([a-f0-9]{32})$/gmu)].map(
    (match) => match[1]
  );
  if (eventIds.length === 0 || (eventId !== undefined && !eventIds.includes(eventId))) {
    throw new Error('search_issue_events did not return the required event evidence');
  }
}

export function validateMcpEvidence({
  initializeResult,
  detailsResult,
  searchResult,
  expectedEventId,
}) {
  const server = validateMcpServer(initializeResult);
  const eventId = requiredString(expectedEventId, 'expected event ID');
  if (!EVENT_ID_PATTERN.test(eventId)) throw new Error('Invalid expected event ID');
  const detailsText = toolText(detailsResult, 'get_issue_details');
  if (requiredMarkdownField(detailsText, 'Event ID') !== eventId) {
    throw new Error('get_issue_details returned a different event ID');
  }
  // The by-ID lookup proves the original event. A finite recent-results page
  // can contain only newer events while that original remains retained.
  validateEventSearch(searchResult);

  const stackMatch = detailsText.match(
    /\*\*(?:Full )?Stacktrace:\*\*\n(?:─+\n)?```\n([\s\S]*?)\n```/u
  );
  const stack = stackMatch?.[1]
    ?.split('\n')
    .map((line) => line.trim())
    .find((line) => line !== '');
  if (stack === undefined || stack === 'No stacktrace available') {
    throw new Error('get_issue_details did not return a stack frame');
  }

  return {
    environment: requiredMarkdownField(detailsText, 'environment'),
    eventId,
    ...server,
    project: requiredMarkdownField(detailsText, 'Project'),
    release: requiredMarkdownField(detailsText, 'release'),
    stack,
    title: requiredMarkdownField(detailsText, 'Description'),
    tools: ['get_issue_details', 'search_issue_events'],
  };
}

class VerificationError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

// Run inside the worker to exercise its DNS override, CA roots, TLS SNI and
// hostname verification. Read only the status from the private response.
const HTTPS_STATUS_SCRIPT = `
  import { get } from 'node:https';
  const request = get(process.argv[2], {
    rejectUnauthorized: true,
    ...(process.argv[1] === 'compatibility' && {
      headers: { authorization: 'Bearer tailnet-only' },
    }),
  }, (response) => {
    process.stdout.write(String(response.statusCode));
    response.destroy();
  });
  request.on('error', () => { process.exitCode = 1; });
`;

async function httpsStatus(containerName, url, signal, compatibility = false) {
  return await runDockerCommand(
    [
      'exec',
      containerName,
      'node',
      '--input-type=module',
      '--eval',
      HTTPS_STATUS_SCRIPT,
      compatibility ? 'compatibility' : 'readiness',
      url,
    ],
    signal
  );
}

export async function verifyErrorHubMcp(config, options = {}) {
  const timer = AbortSignal.timeout(VERIFICATION_TIMEOUT_MS);
  const signal = options.signal === undefined ? timer : AbortSignal.any([timer, options.signal]);
  const containerName = `intexura-error-hub-mcp-verify-${process.pid}-${randomUUID()}`;
  let session;
  let attemptedRun = false;
  let errorCode = 'worker_start_failed';

  try {
    const args = buildDockerArguments(config, containerName);
    attemptedRun = true;
    await runDockerCommand(args, signal);
    await waitForWorkerReady(containerName, signal);

    errorCode = 'https_readiness_failed';
    if (
      (await httpsStatus(containerName, `https://${config.host}/health/ready`, signal)) !== '200'
    ) {
      throw new Error('Error Hub readiness was unsuccessful');
    }

    errorCode = 'mcp_configuration_invalid';
    const entryJson = await runDockerCommand(
      ['exec', containerName, 'codex', 'mcp', 'get', 'error_hub', '--json'],
      signal
    );
    const entry = parseErrorHubMcpEntry(entryJson);

    errorCode = 'mcp_transport_failed';
    const child = spawn(
      'docker',
      ['exec', '--interactive', containerName, entry.command, ...entry.args],
      { stdio: ['pipe', 'pipe', 'ignore'], signal, killSignal: 'SIGKILL' }
    );
    session = createJsonRpcSession(child);

    const initializeResult = await session.request('initialize', {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: {
        name: 'intexuraos-error-hub-verifier',
        version: '1.0.0',
      },
    });
    const identity = validateMcpServer(initializeResult);
    session.notify('notifications/initialized', {});

    const toolsResult = record(await session.request('tools/list', {}), 'MCP tools result');
    const tools = array(toolsResult.tools, 'MCP tools');
    if (!tools.some((tool) => record(tool, 'MCP tool').name === 'execute_sentry_tool')) {
      throw new Error('Sentry MCP does not expose execute_sentry_tool');
    }

    const businessAccess = config.mode !== 'transport-only';
    if (businessAccess) {
      errorCode = 'business_evidence_failed';
      await readIssueEvidence(config, session, initializeResult, containerName, signal);
    }

    errorCode = 'mcp_transport_failed';
    await session.close();
    return { mode: config.mode, transportReady: true, businessAccess, ...identity };
  } catch (error) {
    if (options.signal?.aborted) throw new VerificationError('interrupted');
    if (timer.aborted) throw new VerificationError('timed_out');
    if (error instanceof VerificationError) throw error;
    throw new VerificationError(errorCode);
  } finally {
    if (session !== undefined) await session.abort();
    if (attemptedRun) await removeDisposableContainer(containerName);
  }
}

async function readIssueEvidence(config, session, initializeResult, containerName, signal) {
  let currentEventId;
  try {
    const detailsResult = await session.request('tools/call', {
      name: 'execute_sentry_tool',
      arguments: {
        name: 'get_issue_details',
        arguments:
          config.mode === 'acceptance'
            ? {
                organizationSlug: ORGANIZATION_SLUG,
                issueId: config.issueId,
                eventId: config.eventId,
              }
            : { issueUrl: config.issueUrl },
      },
    });
    if (config.mode === 'probe') {
      const detailsText = toolText(detailsResult, 'get_issue_details');
      const eventId = requiredMarkdownField(detailsText, 'Event ID');
      if (!EVENT_ID_PATTERN.test(eventId)) throw new Error('Invalid current event ID');
      currentEventId = eventId;
    }

    const searchResult = await session.request('tools/call', {
      name: 'execute_sentry_tool',
      arguments: {
        name: 'search_issue_events',
        arguments: {
          issueUrl: config.issueUrl,
          sort: '-timestamp',
          period: '90d',
          limit: 100,
        },
      },
    });
    if (config.mode === 'probe') {
      validateEventSearch(searchResult, currentEventId);
    } else {
      validateMcpEvidence({
        detailsResult,
        expectedEventId: config.eventId,
        initializeResult,
        searchResult,
      });
    }
  } catch (error) {
    if (config.mode === 'probe' && !signal.aborted) {
      // A verified 404 allows the monitor to reselect after retention removed
      // the issue or event. Never interpret an MCP error string as a 404.
      const url = new URL(
        `/api/0/organizations/${ORGANIZATION_SLUG}/issues/${config.issueId}/events/${currentEventId ?? 'latest'}/`,
        config.issueUrl
      );
      const status = await httpsStatus(containerName, url.href, signal, true).catch(
        () => undefined
      );
      if (status === '404') throw new VerificationError('issue_not_found');
    }
    throw error;
  }
}

async function waitForWorkerReady(containerName, signal) {
  const readiness = AbortSignal.any([signal, AbortSignal.timeout(WORKER_READY_TIMEOUT_MS)]);
  while (!readiness.aborted) {
    try {
      await runDockerCommand(['exec', containerName, 'test', '-f', '/tmp/worker-ready'], readiness);
      return;
    } catch {
      await delay(250, undefined, { signal: readiness });
    }
  }
  readiness.throwIfAborted();
}

async function runDockerCommand(args, signal) {
  signal.throwIfAborted();
  const child = spawn('docker', args, {
    stdio: ['ignore', 'pipe', 'ignore'],
    signal,
    killSignal: 'SIGKILL',
  });
  let stdout = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    if (stdout.length < 65_536) stdout += String(chunk).slice(0, 65_536 - stdout.length);
  });

  return new Promise((resolve, reject) => {
    // Wait for close before cleanup even if the child is signalled.
    child.once('error', () => undefined);
    child.once('close', (code) => {
      if (code === 0 && !signal.aborted) {
        resolve(stdout.trim());
      } else {
        reject(new Error('Docker command failed'));
      }
    });
  });
}

function createJsonRpcSession(child) {
  let nextId = 1;
  let stdoutBuffer = '';
  let closed = false;
  const pending = new Map();

  function rejectPending(error) {
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  }

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdoutBuffer += chunk;
    if (stdoutBuffer.length > 1_048_576) {
      rejectPending(new Error('Sentry MCP output exceeded the response limit'));
      child.kill('SIGKILL');
      return;
    }
    while (true) {
      const newline = stdoutBuffer.indexOf('\n');
      if (newline === -1) break;
      const line = stdoutBuffer.slice(0, newline).trim();
      stdoutBuffer = stdoutBuffer.slice(newline + 1);
      if (line === '') continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        rejectPending(new Error('Sentry MCP emitted invalid JSON-RPC output'));
        child.kill('SIGKILL');
        return;
      }
      if (typeof message !== 'object' || message === null || !('id' in message)) continue;
      const request = pending.get(message.id);
      if (request === undefined) continue;
      pending.delete(message.id);
      if (message.jsonrpc !== '2.0' || 'error' in message || !('result' in message)) {
        request.reject(
          new Error('Sentry MCP returned an invalid or unsuccessful JSON-RPC response')
        );
      } else {
        request.resolve(message.result);
      }
    }
  });

  child.stdin.on('error', () => rejectPending(new Error('Sentry MCP input failed')));
  const exit = new Promise((resolve) => {
    child.once('error', () => rejectPending(new Error('Sentry MCP could not run')));
    child.once('close', (code) => {
      closed = true;
      rejectPending(new Error('Sentry MCP transport closed'));
      resolve(code);
    });
  });

  function send(message) {
    if (closed || child.stdin.destroyed) throw new Error('Sentry MCP transport is closed');
    child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  return {
    request(method, params) {
      const id = nextId;
      nextId += 1;
      return new Promise((resolve, reject) => {
        pending.set(id, { reject, resolve });
        try {
          send({ jsonrpc: '2.0', id, method, params });
        } catch (error) {
          pending.delete(id);
          reject(error);
        }
      });
    },
    notify(method, params) {
      send({ jsonrpc: '2.0', method, params });
    },
    async close() {
      if (!child.stdin.destroyed) child.stdin.end();
      if ((await exit) !== 0) throw new Error('Sentry MCP transport failed to close');
    },
    async abort() {
      if (!closed) {
        child.stdin.destroy();
        child.kill('SIGKILL');
      }
      await exit;
    },
  };
}

function toolText(value, toolName) {
  const result = record(value, `${toolName} result`);
  if (result.isError === true) throw new Error(`${toolName} returned an MCP error`);
  const content = array(result.content, `${toolName} content`);
  const text = content
    .filter((item) => record(item, `${toolName} content item`).type === 'text')
    .map((item) => {
      const value = record(item, `${toolName} content item`).text;
      if (typeof value !== 'string' || value.trim() === '') {
        throw new TypeError(`${toolName} text must be a non-empty string`);
      }
      return value;
    })
    .join('\n')
    .trim();
  if (text === '') throw new Error(`${toolName} returned no text evidence`);
  return text;
}

function requiredMarkdownField(text, label) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const match = text.match(new RegExp(`^\\*\\*${escapedLabel}\\*\\*: (.+)$`, 'mu'));
  return requiredString(match?.[1], `${label} evidence`);
}

function requiredEnvironment(environment, key) {
  if (typeof environment !== 'object' || environment === null) {
    throw new TypeError(`${key} is required`);
  }
  return requiredString(environment[key], key);
}

function requiredString(value, field) {
  if (typeof value !== 'string' || value === '' || value.trim() !== value) {
    throw new TypeError(`${field} must be a non-empty string without surrounding whitespace`);
  }
  return value;
}

function record(value, field) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object`);
  }
  return value;
}

function array(value, field) {
  if (!Array.isArray(value)) throw new TypeError(`${field} must be an array`);
  return value;
}

async function removeDisposableContainer(containerName) {
  const signal = AbortSignal.timeout(CLEANUP_TIMEOUT_MS);
  try {
    const id = await runDockerCommand(
      ['ps', '--all', '--quiet', '--no-trunc', '--filter', `name=^/${containerName}$`],
      signal
    );
    if (id === '') return; // Docker may already have auto-removed the container.
    if (!/^[a-f0-9]{64}$/u.test(id)) throw new Error('Unexpected container identity');
    try {
      const identity = await runDockerCommand(
        [
          'inspect',
          '--type',
          'container',
          '--format',
          `{{.Id}} {{index .Config.Labels "${PROBE_LABEL}"}}`,
          id,
        ],
        signal
      );
      if (identity !== `${id} ${containerName}`) throw new VerificationError('cleanup_failed');
      await runDockerCommand(['rm', '--force', id], signal);
    } catch (error) {
      if (error instanceof VerificationError) throw error;
      const remaining = await runDockerCommand(
        ['ps', '--all', '--quiet', '--no-trunc', '--filter', `id=${id}`],
        signal
      );
      if (remaining !== '') throw error;
    }
  } catch {
    throw new VerificationError('cleanup_failed');
  }
}

async function main() {
  let mode = null;
  const interruption = new AbortController();
  const interrupt = () => interruption.abort();
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);

  try {
    const config = parseVerificationConfiguration(process.argv.slice(2), process.env);
    mode = config.mode;
    const result = await verifyErrorHubMcp(config, { signal: interruption.signal });
    process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`);
  } catch (error) {
    const code = error instanceof VerificationError ? error.code : 'configuration_invalid';
    process.stdout.write(`${JSON.stringify({ ok: false, mode, error: code })}\n`);
    process.exitCode = 1;
  } finally {
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main();
}
