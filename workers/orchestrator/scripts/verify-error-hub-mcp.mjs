import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const EXPECTED_MCP_NAME = 'Sentry MCP';
const EXPECTED_MCP_VERSION = '0.37.0';
const MCP_PROTOCOL_VERSION = '2025-06-18';
const ORGANIZATION_SLUG = 'intexuraos';
const WORKER_NETWORK = 'code-worker-net';
const REQUEST_TIMEOUT_MS = 60_000;
const WORKER_READY_TIMEOUT_MS = 30_000;
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
  if (!Array.isArray(argv) || argv.length !== 2) {
    throw new TypeError('usage: verify:error-hub-mcp <private issue URL> <event ID>');
  }

  const issueUrlText = requiredString(argv[0], 'private issue URL');
  const eventId = requiredString(argv[1], 'event ID');
  if (!EVENT_ID_PATTERN.test(eventId)) {
    throw new TypeError('event ID must be exactly 32 lowercase hexadecimal characters');
  }

  const host = requiredEnvironment(environment, 'INTEXURAOS_ERROR_HUB_HOST');
  validatePrivateHost(host);
  const image = requiredEnvironment(environment, 'INTEXURAOS_CODE_WORKER_IMAGE');
  if (!IMMUTABLE_IMAGE_PATTERN.test(image)) {
    throw new TypeError('INTEXURAOS_CODE_WORKER_IMAGE must be an immutable sha256 image reference');
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
    eventId,
    host,
    image,
    issueId: issueMatch[1],
    issueUrl: issueUrlText,
  };
}

export function buildDockerArguments(config, containerName) {
  requiredString(containerName, 'container name');
  return [
    'run',
    '--rm',
    '--detach',
    '--name',
    containerName,
    '--network',
    WORKER_NETWORK,
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

export function validateMcpEvidence({
  initializeResult,
  detailsResult,
  searchResult,
  expectedEventId,
}) {
  const initialize = record(initializeResult, 'MCP initialize result');
  const serverInfo = record(initialize.serverInfo, 'MCP serverInfo');
  const mcpName = requiredString(serverInfo.name, 'MCP server name');
  const mcpVersion = requiredString(serverInfo.version, 'MCP server version');
  if (mcpName !== EXPECTED_MCP_NAME || mcpVersion !== EXPECTED_MCP_VERSION) {
    throw new Error(
      `expected ${EXPECTED_MCP_NAME} ${EXPECTED_MCP_VERSION}, received ${mcpName} ${mcpVersion}`
    );
  }

  const eventId = requiredString(expectedEventId, 'expected event ID');
  const detailsText = toolText(detailsResult, 'get_issue_details');
  const searchText = toolText(searchResult, 'search_issue_events');
  if (requiredMarkdownField(detailsText, 'Event ID') !== eventId) {
    throw new Error('get_issue_details returned a different event ID');
  }
  if (!searchText.includes(eventId)) {
    throw new Error('search_issue_events did not return the expected event ID');
  }

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
    mcpName,
    mcpVersion,
    project: requiredMarkdownField(detailsText, 'Project'),
    release: requiredMarkdownField(detailsText, 'release'),
    stack,
    title: requiredMarkdownField(detailsText, 'Description'),
    tools: ['get_issue_details', 'search_issue_events'],
  };
}

export async function verifyErrorHubMcp(config) {
  const containerName = `intexura-error-hub-mcp-verify-${process.pid}-${randomUUID().slice(0, 8)}`;
  let session;

  try {
    await runDockerCommand(buildDockerArguments(config, containerName));
    await waitForWorkerReady(containerName);
    const entryJson = await runDockerCommand([
      'exec',
      containerName,
      'codex',
      'mcp',
      'get',
      'error_hub',
      '--json',
    ]);
    const entry = parseErrorHubMcpEntry(entryJson);
    const child = spawn(
      'docker',
      ['exec', '--interactive', containerName, entry.command, ...entry.args],
      { stdio: ['pipe', 'pipe', 'pipe'] }
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
    session.notify('notifications/initialized', {});

    const toolsResult = record(await session.request('tools/list', {}), 'MCP tools result');
    const tools = array(toolsResult.tools, 'MCP tools');
    if (!tools.some((tool) => record(tool, 'MCP tool').name === 'execute_sentry_tool')) {
      throw new Error('Sentry MCP does not expose execute_sentry_tool');
    }

    const detailsResult = await session.request('tools/call', {
      name: 'execute_sentry_tool',
      arguments: {
        name: 'get_issue_details',
        arguments: { issueUrl: config.issueUrl },
      },
    });
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
    const evidence = validateMcpEvidence({
      detailsResult,
      expectedEventId: config.eventId,
      initializeResult,
      searchResult,
    });
    await session.close();
    return { issueUrl: config.issueUrl, ...evidence };
  } catch (error) {
    if (session !== undefined) await session.abort();
    throw error;
  } finally {
    await removeDisposableContainer(containerName);
  }
}

async function waitForWorkerReady(containerName) {
  const deadline = Date.now() + WORKER_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      await runDockerCommand(['exec', containerName, 'test', '-f', '/tmp/worker-ready']);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error('Code Worker did not become ready for Error Hub MCP verification');
}

async function runDockerCommand(args) {
  const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    if (stdout.length < 65_536) stdout += String(chunk).slice(0, 65_536 - stdout.length);
  });
  child.stderr.on('data', (chunk) => {
    if (stderr.length < 16_384) stderr += String(chunk).slice(0, 16_384 - stderr.length);
  });

  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }
      const diagnostic = stderr.trim();
      reject(
        new Error(
          `Docker command exited with ${code === null ? String(signal) : `code ${String(code)}`}${diagnostic === '' ? '' : `: ${diagnostic}`}`
        )
      );
    });
  });
}

function createJsonRpcSession(child) {
  let nextId = 1;
  let stdoutBuffer = '';
  let stderrBuffer = '';
  let closed = false;
  const pending = new Map();

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    if (stderrBuffer.length < 16_384) stderrBuffer += String(chunk).slice(0, 16_384);
  });
  child.stdout.on('data', (chunk) => {
    stdoutBuffer += chunk;
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
        continue;
      }
      if (typeof message !== 'object' || message === null || !('id' in message)) continue;
      const request = pending.get(message.id);
      if (request === undefined) continue;
      pending.delete(message.id);
      clearTimeout(request.timeout);
      if ('error' in message) {
        request.reject(new Error(jsonRpcErrorMessage(message.error)));
      } else {
        request.resolve(message.result);
      }
    }
  });

  const exit = new Promise((resolve, reject) => {
    child.once('error', (error) => {
      rejectPending(error);
      reject(error);
    });
    child.once('close', (code, signal) => {
      closed = true;
      if (code === 0) {
        resolve();
        return;
      }
      const diagnostic = stderrBuffer.trim();
      const error = new Error(
        `Sentry MCP container exited with ${code === null ? String(signal) : `code ${String(code)}`}${diagnostic === '' ? '' : `: ${diagnostic}`}`
      );
      rejectPending(error);
      reject(error);
    });
  });

  function rejectPending(error) {
    for (const request of pending.values()) {
      clearTimeout(request.timeout);
      request.reject(error);
    }
    pending.clear();
  }

  function send(message) {
    if (closed || child.stdin.destroyed) throw new Error('Sentry MCP transport is closed');
    child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  return {
    request(method, params) {
      const id = nextId;
      nextId += 1;
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Sentry MCP request timed out: ${method}`));
        }, REQUEST_TIMEOUT_MS);
        pending.set(id, { reject, resolve, timeout });
        try {
          send({ jsonrpc: '2.0', id, method, params });
        } catch (error) {
          clearTimeout(timeout);
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
      await exit;
    },
    async abort() {
      rejectPending(new Error('Sentry MCP verification aborted'));
      if (!child.stdin.destroyed) child.stdin.destroy();
      if (!closed) child.kill('SIGTERM');
      await Promise.race([
        exit.catch(() => undefined),
        new Promise((resolve) => setTimeout(resolve, 2_000)),
      ]);
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

function validatePrivateHost(value) {
  if (/\s/u.test(value)) throw new TypeError('INTEXURAOS_ERROR_HUB_HOST is invalid');
  let origin;
  try {
    origin = new URL(`https://${value}`);
  } catch {
    throw new TypeError('INTEXURAOS_ERROR_HUB_HOST is invalid');
  }
  const tailnetDnsHostnamePattern =
    /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.){2,}ts\.net$/u;
  if (
    origin.hostname === '' ||
    !tailnetDnsHostnamePattern.test(origin.hostname.toLowerCase()) ||
    origin.port !== '8443' ||
    origin.host.toLowerCase() !== value.toLowerCase() ||
    origin.username !== '' ||
    origin.password !== '' ||
    origin.pathname !== '/' ||
    origin.search !== '' ||
    origin.hash !== ''
  ) {
    throw new TypeError('INTEXURAOS_ERROR_HUB_HOST must be a tailnet DNS host on port 8443');
  }
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

function jsonRpcErrorMessage(value) {
  if (typeof value === 'object' && value !== null && 'message' in value) {
    return requiredString(value.message, 'JSON-RPC error message');
  }
  return 'Sentry MCP returned a JSON-RPC error';
}

async function removeDisposableContainer(containerName) {
  await new Promise((resolve) => {
    const cleanup = spawn('docker', ['rm', '--force', containerName], {
      stdio: 'ignore',
    });
    cleanup.once('error', () => resolve());
    cleanup.once('close', () => resolve());
  });
}

async function main() {
  const config = parseVerificationConfiguration(process.argv.slice(2), process.env);
  const result = await verifyErrorHubMcp(config);
  process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'Error Hub MCP verification failed'}\n`
    );
    process.exitCode = 1;
  });
}
