import { execFile, execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertWorkerNetworkContract, WORKER_NETWORK_NAME } from './worker-network-contract.js';
import { createAaaaOnlyDockerProxy } from './aaaa-only-docker-proxy.js';

const execFileAsync = promisify(execFile);
const workerImage = process.env['ERROR_HUB_MCP_E2E_IMAGE'] ?? process.env['WORKER_IMAGE'];
const network = WORKER_NETWORK_NAME;
const eventId = 'cccccccccccccccccccccccccccccccc';
const fixtureHost = `error-hub-mcp-${String(process.pid)}.test.ts.net`;
const fixtureContainer = `error-hub-mcp-fixture-${String(process.pid)}`;
const baseImageTag = `error-hub-mcp-base:${String(process.pid)}`;
const trustedImageTag = `error-hub-mcp-trusted:${String(process.pid)}`;
const scriptPath = resolve(
  dirname(new URL(import.meta.url).pathname),
  '../../../../scripts/verify-error-hub-mcp.mjs'
);
const executableTemporaryDirectory = process.platform === 'linux' ? '/var/tmp' : tmpdir();

function commandSucceeds(command: string, args: string[]): boolean {
  try {
    execFileSync(command, args, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const prerequisitesAvailable =
  workerImage !== undefined &&
  commandSucceeds('docker', ['info']) &&
  commandSucceeds('docker', ['network', 'inspect', network]) &&
  commandSucceeds('docker', ['image', 'inspect', workerImage]) &&
  commandSucceeds('openssl', ['version']);

describe.skipIf(!prerequisitesAvailable)('Error Hub MCP worker image verification', () => {
  let directory = '';
  let dockerProxyEnvironment: Readonly<Record<string, string>> = {};
  let trustedImageId = '';
  let workerPlatform = '';

  beforeAll(async () => {
    assertWorkerNetworkContract();
    directory = mkdtempSync(join(executableTemporaryDirectory, 'error-hub-mcp-e2e-'));
    const tlsDirectory = join(directory, 'tls');
    const trustDirectory = join(directory, 'trust');
    mkdirSync(tlsDirectory);
    mkdirSync(trustDirectory);
    const keyPath = join(tlsDirectory, 'key.pem');
    const certificatePath = join(tlsDirectory, 'cert.pem');
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        keyPath,
        '-out',
        certificatePath,
        '-days',
        '1',
        '-sha256',
        '-subj',
        `/CN=${fixtureHost}`,
        '-addext',
        `subjectAltName=DNS:${fixtureHost}`,
      ],
      { stdio: 'ignore' }
    );
    // Rootless/user-namespaced Docker cannot read OpenSSL's default 0600 host file
    // through a bind mount. This key is short-lived and only secures the local test fixture.
    chmodSync(keyPath, 0o644);
    const baseImageId = execFileSync(
      'docker',
      ['image', 'inspect', '--format', '{{.Id}}', workerImage ?? ''],
      { encoding: 'utf8' }
    ).trim();
    execFileSync('docker', ['image', 'tag', baseImageId, baseImageTag], {
      stdio: 'ignore',
    });
    writeFileSync(
      join(trustDirectory, 'Dockerfile'),
      `FROM ${baseImageTag}
USER root
COPY ca.pem /etc/ssl/certs/error-hub-mcp-e2e-ca.pem
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/error-hub-mcp-e2e-ca.pem
USER claude
`,
      'utf8'
    );
    writeFileSync(join(trustDirectory, 'ca.pem'), readFileSync(certificatePath));
    workerPlatform = execFileSync(
      'docker',
      ['image', 'inspect', '--format', '{{.Os}}/{{.Architecture}}', workerImage ?? ''],
      { encoding: 'utf8' }
    ).trim();
    execFileSync(
      'docker',
      ['build', '--platform', workerPlatform, '--tag', trustedImageTag, trustDirectory],
      { stdio: 'ignore' }
    );
    trustedImageId = execFileSync(
      'docker',
      ['image', 'inspect', '--format', '{{.Id}}', trustedImageTag],
      { encoding: 'utf8' }
    ).trim();

    const fixtureSource = resolve(
      dirname(new URL(import.meta.url).pathname),
      'fixtures/error-hub-mcp-server.mjs'
    );
    execFileSync(
      'docker',
      [
        'run',
        '--detach',
        '--platform',
        workerPlatform,
        '--name',
        fixtureContainer,
        '--network',
        network,
        '--network-alias',
        fixtureHost,
        '--read-only',
        '--cap-drop',
        'ALL',
        '--security-opt',
        'no-new-privileges:true',
        '--user',
        '0:0',
        '--tmpfs',
        '/tmp:size=16m,mode=1777',
        '--mount',
        `type=bind,src=${fixtureSource},dst=/fixture/server.mjs,readonly`,
        '--mount',
        `type=bind,src=${tlsDirectory},dst=/fixture/tls,readonly`,
        '--env',
        `FIXTURE_EVENT_ID=${eventId}`,
        '--env',
        `FIXTURE_HOST=${fixtureHost}`,
        '--entrypoint',
        'node',
        trustedImageId,
        '/fixture/server.mjs',
      ],
      { stdio: 'ignore' }
    );

    const fixtureIpv6Address = execFileSync(
      'docker',
      [
        'container',
        'inspect',
        '--format',
        '{{range .NetworkSettings.Networks}}{{.GlobalIPv6Address}}{{end}}',
        fixtureContainer,
      ],
      { encoding: 'utf8' }
    ).trim();
    if (!fixtureIpv6Address.startsWith('fd00:172:28:')) {
      throw new Error(`HTTPS SentryBox fixture has invalid IPv6 address: ${fixtureIpv6Address}`);
    }
    const realDockerPath = execFileSync('sh', ['-c', 'command -v docker'], {
      encoding: 'utf8',
    }).trim();
    dockerProxyEnvironment = createAaaaOnlyDockerProxy({
      directory,
      host: fixtureHost,
      ipv6Address: fixtureIpv6Address,
      realDockerPath,
    }).environment;

    let ready = false;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      ready = commandSucceeds('docker', [
        'exec',
        fixtureContainer,
        'node',
        '--input-type=module',
        '--eval',
        "process.env.NODE_TLS_REJECT_UNAUTHORIZED='0';const r=await fetch('https://[::1]:8443/health');if(!r.ok)process.exit(1)",
      ]);
      if (ready) break;
      await new Promise((resolveWait) => setTimeout(resolveWait, 250));
    }
    if (!ready) {
      const logs = execFileSync('docker', ['logs', fixtureContainer], {
        encoding: 'utf8',
      }).trim();
      throw new Error(`HTTPS SentryBox fixture did not become ready: ${logs}`);
    }
  }, 120_000);

  afterAll(() => {
    commandSucceeds('docker', ['rm', '--force', fixtureContainer]);
    commandSucceeds('docker', ['image', 'rm', '--force', trustedImageTag]);
    commandSucceeds('docker', ['image', 'rm', baseImageTag]);
    if (directory !== '') rmSync(directory, { recursive: true, force: true });
  });

  it('runs Sentry MCP 0.37.0 from the Code Worker image over HTTPS on code-worker-net', async () => {
    const issueUrl = `https://${fixtureHost}:8443/organizations/intexuraos/issues/42/`;
    const { stdout } = await execFileAsync(process.execPath, [scriptPath, issueUrl, eventId], {
      env: {
        ...process.env,
        ...dockerProxyEnvironment,
        INTEXURAOS_CODE_WORKER_IMAGE: trustedImageId,
        INTEXURAOS_ERROR_HUB_HOST: `${fixtureHost}:8443`,
        PATH: `${directory}:${process.env['PATH'] ?? ''}`,
      },
      maxBuffer: 1024 * 1024,
      timeout: 90_000,
    });

    expect(JSON.parse(stdout)).toEqual({
      environment: 'dev',
      eventId,
      issueUrl,
      mcpName: 'Sentry MCP',
      mcpVersion: '0.37.0',
      ok: true,
      project: 'IntexuraOS Backend',
      release: 'intexuraos-sentrybox-acceptance@1.0.0',
      stack: 'at emitControlledIssue (scripts/acceptance/emit-controlled-issue.mjs:1:1)',
      title: 'Controlled SentryBox validation fault',
      tools: ['get_issue_details', 'search_issue_events'],
    });

    const peerEvidence = JSON.parse(
      execFileSync('docker', ['exec', fixtureContainer, 'cat', '/tmp/last-peer.json'], {
        encoding: 'utf8',
      })
    ) as unknown;
    expect(peerEvidence).toMatchObject({ family: 'IPv6' });
    expect(peerEvidence).toHaveProperty('address', expect.stringMatching(/^fd00:172:28:/u));
  }, 120_000);
});
