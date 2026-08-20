import { spawnSync } from 'node:child_process';
import {
  chownSync,
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '..', '..');
const validatorPath = resolve(repoRoot, 'scripts/hetzner/validate-prod-secret-candidate.sh');
const loaderPath = resolve(repoRoot, 'scripts/hetzner/load-secrets.sh');
const terraformPath = resolve(repoRoot, 'terraform/environments/dev/main.tf');
const operationsPath = resolve(repoRoot, 'docs/operations/secret-packages.md');
const pubsubServerPath = resolve(repoRoot, 'tools/pubsub-ui/server.mjs');
const pubsubUiPath = resolve(repoRoot, 'tools/pubsub-ui/index.html');
const pubsubReadmePath = resolve(repoRoot, 'tools/pubsub-ui/README.md');
const pubsubPublishTestPath = resolve(repoRoot, 'scripts/pubsub-publish-test.mjs');

const tokenId = '0123456789abcdef0123456789abcdef';
const accountId = 'e4bc566c37e21368bffb131d2ac69358';
const zoneId = 'abcdef0123456789abcdef0123456789';
const cloudflareToken = 'cloudflare-token-secret-that-must-not-be-logged';
const runtimeToken = 'runtime-token-secret-that-must-not-be-logged';

interface Fixture {
  attestationDirectory: string;
  cloudflareCredentialsPath: string;
  root: string;
  runtimeCredentialPath: string;
  tracePath: string;
}

function fixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'prod-candidate-canary-'));
  const fakeBin = join(root, 'bin');
  const attestationDirectory = join(root, 'attestations');
  const runtimeCredentialPath = join(root, 'runtime-sa-key.json');
  const cloudflareCredentialsPath = join(root, 'cloudflare.ini');
  const tracePath = join(root, 'trace.jsonl');
  mkdirSync(fakeBin, { mode: 0o700 });
  mkdirSync(attestationDirectory, { mode: 0o700 });
  writeFileSync(
    runtimeCredentialPath,
    JSON.stringify({
      type: 'service_account',
      private_key: 'runtime-private-key-secret-that-must-not-be-logged',
    }),
    { mode: 0o600 }
  );
  writeFileSync(cloudflareCredentialsPath, `dns_cloudflare_api_token = ${cloudflareToken}\n`, {
    mode: 0o600,
  });
  writeFileSync(
    join(attestationDirectory, 'prod-v17.json'),
    `${JSON.stringify({
      schemaVersion: 1,
      environment: 'prod',
      packageVersion: '17',
      accountId,
      zoneName: 'intexuraos.cloud',
      permission: 'Zone DNS Edit',
      resourceScope: 'exact-zone',
      tokenId,
      verifiedAt: new Date().toISOString(),
      verifiedBy: 'release-operator@example.com',
      evidenceReference: 'change-record-secret-package-prod-v17',
    })}\n`,
    { mode: 0o600 }
  );

  writeFileSync(
    join(fakeBin, 'gcloud'),
    [
      '#!/usr/bin/env python3',
      'import os, sys, time',
      'if os.environ.get("CANARY_FAIL_ENDPOINT") == "token": sys.exit(71)',
      'time.sleep(float(os.environ.get("CANARY_GCLOUD_SLEEP_SECONDS", "0")))',
      `print('${runtimeToken}')`,
      '',
    ].join('\n'),
    { mode: 0o700 }
  );

  writeFileSync(
    join(fakeBin, 'timeout'),
    [
      '#!/usr/bin/env python3',
      'import subprocess, sys',
      'arguments = sys.argv[1:]',
      'while arguments and arguments[0].startswith("--"): arguments.pop(0)',
      'duration = float(arguments.pop(0))',
      'try:',
      '  result = subprocess.run(arguments, timeout=duration)',
      '  sys.exit(result.returncode)',
      'except subprocess.TimeoutExpired:',
      '  sys.exit(124)',
      '',
    ].join('\n'),
    { mode: 0o700 }
  );

  writeFileSync(
    join(fakeBin, 'curl'),
    [
      '#!/usr/bin/env node',
      "import { appendFileSync, writeFileSync } from 'node:fs';",
      'const args = process.argv.slice(2);',
      "const methodIndex = args.indexOf('--request');",
      "const method = methodIndex >= 0 ? args[methodIndex + 1] : 'GET';",
      "const connectTimeoutIndex = args.indexOf('--connect-timeout');",
      'const connectTimeout = connectTimeoutIndex >= 0 ? args[connectTimeoutIndex + 1] : undefined;',
      "const maxTimeIndex = args.indexOf('--max-time');",
      'const maxTime = maxTimeIndex >= 0 ? args[maxTimeIndex + 1] : undefined;',
      "const url = args.find((value) => /^https:\\/\\//u.test(value)) ?? '';",
      "const outputIndex = args.indexOf('--output');",
      "const output = outputIndex >= 0 ? args[outputIndex + 1] : '/dev/null';",
      "let endpoint = 'unknown';",
      "let response = '{}';",
      "if (url.includes('firestore.googleapis.com')) endpoint = 'firestore';",
      "else if (url.includes('storage.googleapis.com')) endpoint = 'storage';",
      "else if (url.includes('identitytoolkit.googleapis.com')) endpoint = 'firebase-auth';",
      "else if (url.includes('pubsub.googleapis.com')) {",
      "  endpoint = 'pubsub';",
      "  response = process.env.CANARY_MISSING_MESSAGE_ID === '1' ? '{}' : JSON.stringify({ messageIds: ['message-id-canary'] });",
      "} else if (url.endsWith('/user/tokens/verify')) {",
      "  endpoint = 'cloudflare-verify';",
      "  const id = process.env.CANARY_WRONG_TOKEN_ID === '1' ? 'f'.repeat(32) : process.env.CANARY_TOKEN_ID;",
      "  response = JSON.stringify({ success: true, result: { id, status: 'active' } });",
      "} else if (url.endsWith('/zones')) {",
      "  endpoint = 'cloudflare-zone';",
      "  response = JSON.stringify({ success: true, result: [{ id: process.env.CANARY_ZONE_ID, name: 'intexuraos.cloud', status: 'active', account: { id: process.env.CANARY_ACCOUNT_ID } }] });",
      "} else if (url.includes('/dns_records')) {",
      "  endpoint = 'cloudflare-dns';",
      '  response = JSON.stringify({ success: true, result: [] });',
      '}',
      'appendFileSync(process.env.CANARY_TRACE_PATH, `${JSON.stringify({ connectTimeout, endpoint, maxTime, method, url })}\\n`);',
      'if (process.env.CANARY_FAIL_ENDPOINT === endpoint) process.exit(72);',
      "if (output !== '/dev/null') writeFileSync(output, response, { mode: 0o600 });",
      '',
    ].join('\n'),
    { mode: 0o700 }
  );

  return {
    attestationDirectory,
    cloudflareCredentialsPath,
    root,
    runtimeCredentialPath,
    tracePath,
  };
}

function runValidator(
  input: Fixture,
  overrides: Record<string, string> = {}
): ReturnType<typeof spawnSync> {
  return spawnSync(
    'bash',
    [
      validatorPath,
      '--runtime-credential',
      input.runtimeCredentialPath,
      '--cloudflare-credentials',
      input.cloudflareCredentialsPath,
      '--package-version',
      '17',
    ],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        CANARY_ACCOUNT_ID: accountId,
        CANARY_TOKEN_ID: tokenId,
        CANARY_TRACE_PATH: input.tracePath,
        CANARY_ZONE_ID: zoneId,
        CLOUDFLARE_DNS_EDIT_ATTESTATION_DIR: input.attestationDirectory,
        EXPECTED_CLOUDFLARE_ACCOUNT_ID: accountId,
        INTEXURAOS_ENVIRONMENT: 'prod',
        PATH: `${join(input.root, 'bin')}:${process.env.PATH ?? ''}`,
        SKIP_OWNERSHIP: '1',
        TMPDIR: input.root,
        ...overrides,
      },
    }
  );
}

function trace(input: Fixture): {
  connectTimeout?: string;
  endpoint: string;
  maxTime?: string;
  method: string;
  url: string;
}[] {
  return readFileSync(input.tracePath, 'utf8')
    .trim()
    .split('\n')
    .filter((line) => line.length > 0)
    .map(
      (line) =>
        JSON.parse(line) as {
          connectTimeout?: string;
          endpoint: string;
          maxTime?: string;
          method: string;
          url: string;
        }
    );
}

function replaceAttestationTimestamp(input: Fixture, verifiedAt: string): void {
  const path = join(input.attestationDirectory, 'prod-v17.json');
  const document = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  writeFileSync(path, `${JSON.stringify({ ...document, verifiedAt })}\n`, { mode: 0o600 });
}

describe('PROD package candidate credential canary', () => {
  it('proves the complete runtime matrix and read-only Cloudflare boundary without logging secrets', () => {
    const input = fixture();
    const result = runValidator(input);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('PROD secret candidate credential canary passed');
    const combinedOutput = `${result.stdout}${result.stderr}`;
    for (const secret of [cloudflareToken, runtimeToken, 'runtime-private-key-secret']) {
      expect(combinedOutput).not.toContain(secret);
    }

    const calls = trace(input);
    expect(calls.map(({ endpoint }) => endpoint)).toEqual([
      'firestore',
      'storage',
      'firebase-auth',
      'pubsub',
      'cloudflare-verify',
      'cloudflare-zone',
      'cloudflare-dns',
    ]);
    expect(calls.find(({ endpoint }) => endpoint === 'firestore')?.method).toBe('POST');
    expect(calls.find(({ endpoint }) => endpoint === 'storage')?.method).toBe('GET');
    expect(calls.find(({ endpoint }) => endpoint === 'firebase-auth')?.method).toBe('POST');
    expect(calls.find(({ endpoint }) => endpoint === 'pubsub')?.method).toBe('POST');
    for (const call of calls.filter(({ endpoint }) => endpoint.startsWith('cloudflare-'))) {
      expect(call.method).toBe('GET');
    }
    expect(calls.find(({ endpoint }) => endpoint === 'storage')?.url).toContain(
      '/b/intexuraos-images-dev/o?maxResults=1&fields=kind'
    );
    expect(calls.find(({ endpoint }) => endpoint === 'pubsub')?.url).toContain(
      '/topics/intexuraos-runtime-credential-canary-dev:publish'
    );
    expect(calls.find(({ endpoint }) => endpoint === 'cloudflare-dns')?.url).toContain(zoneId);
    for (const call of calls) {
      expect(call.connectTimeout).toBe('5');
      expect(call.maxTime).toBe('20');
    }
    expect(readdirSync(input.root).some((name) => name.startsWith('.candidate-canary-'))).toBe(
      false
    );
  });

  it.each([
    'token',
    'firestore',
    'storage',
    'firebase-auth',
    'pubsub',
    'cloudflare-verify',
    'cloudflare-zone',
    'cloudflare-dns',
  ])('fails closed when the %s proof fails', (endpoint) => {
    const input = fixture();
    const result = runValidator(input, { CANARY_FAIL_ENDPOINT: endpoint });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).not.toContain(cloudflareToken);
    expect(`${result.stdout}${result.stderr}`).not.toContain(runtimeToken);
  });

  it('bounds a sleeping gcloud token proof before any HTTP request', () => {
    const input = fixture();
    const startedAt = Date.now();
    const result = runValidator(input, {
      CANARY_GCLOUD_SLEEP_SECONDS: '10',
      GCLOUD_TOKEN_TIMEOUT_SECONDS: '1',
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('token proof timed out');
    expect(Date.now() - startedAt).toBeLessThan(4_000);
    expect(readdirSync(input.root)).not.toContain('trace.jsonl');
  });

  it('requires a Pub/Sub message ID and binds Cloudflare verification to the reviewed token ID', () => {
    const missingMessageId = fixture();
    const publishFailure = runValidator(missingMessageId, { CANARY_MISSING_MESSAGE_ID: '1' });
    expect(publishFailure.status).not.toBe(0);
    expect(publishFailure.stderr).toContain('Pub/Sub publish proof failed');

    const wrongToken = fixture();
    const cloudflareFailure = runValidator(wrongToken, { CANARY_WRONG_TOKEN_ID: '1' });
    expect(cloudflareFailure.status).not.toBe(0);
    expect(cloudflareFailure.stderr).toContain('Cloudflare token verification proof failed');
  });

  it('requires a mode-0600 package-bound exact-zone DNS Edit attestation before network calls', () => {
    const input = fixture();
    const attestationPath = join(input.attestationDirectory, 'prod-v17.json');
    chmodSync(attestationPath, 0o644);
    const result = runValidator(input);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Cloudflare DNS Edit attestation is invalid');
    expect(readdirSync(input.root)).not.toContain('trace.jsonl');
  });

  it('rejects a non-root-owned attestation directory or file before network calls', () => {
    const input = fixture();
    if (typeof process.getuid === 'function' && process.getuid() === 0) {
      chownSync(input.attestationDirectory, 65_534, 65_534);
      chownSync(join(input.attestationDirectory, 'prod-v17.json'), 65_534, 65_534);
    }

    const result = runValidator(input, { SKIP_OWNERSHIP: '0' });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Cloudflare DNS Edit attestation is invalid');
    expect(readdirSync(input.root)).not.toContain('trace.jsonl');
  });

  it.each([
    ['stale', new Date(Date.now() - 24 * 60 * 60 * 1000 - 1_000).toISOString()],
    ['future', new Date(Date.now() + 5 * 60 * 1000 + 60_000).toISOString()],
  ])('rejects a %s Cloudflare attestation before network calls', (_label, verifiedAt) => {
    const input = fixture();
    replaceAttestationTimestamp(input, verifiedAt);
    const result = runValidator(input);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Cloudflare DNS Edit attestation is invalid');
    expect(readdirSync(input.root)).not.toContain('trace.jsonl');
  });

  it('rejects a permissive or symlinked runtime credential before network calls', () => {
    const permissive = fixture();
    chmodSync(permissive.runtimeCredentialPath, 0o640);
    const permissiveResult = runValidator(permissive);
    expect(permissiveResult.status).not.toBe(0);
    expect(permissiveResult.stderr).toContain('Runtime credential is invalid or not mode 600');
    expect(readdirSync(permissive.root)).not.toContain('trace.jsonl');

    const linked = fixture();
    const symlinkPath = join(linked.root, 'runtime-sa-key-link.json');
    symlinkSync(linked.runtimeCredentialPath, symlinkPath);
    linked.runtimeCredentialPath = symlinkPath;
    const linkedResult = runValidator(linked);
    expect(linkedResult.status).not.toBe(0);
    expect(linkedResult.stderr).toContain('Runtime credential is invalid or not mode 600');
    expect(readdirSync(linked.root)).not.toContain('trace.jsonl');
  });

  it.each([
    ['connect', { CURL_CONNECT_TIMEOUT_SECONDS: '0' }],
    ['maximum', { CURL_MAX_TIME_SECONDS: 'not-a-number' }],
  ])('rejects an invalid %s curl timeout before network calls', (_label, environment) => {
    const input = fixture();
    const result = runValidator(input, environment);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('curl timeout');
    expect(readdirSync(input.root)).not.toContain('trace.jsonl');
  });

  it('is wired into every package preflight while retaining explicit offline test skips', () => {
    const loader = readFileSync(loaderPath, 'utf8');

    expect(loader).toContain('validate-prod-secret-candidate.sh');
    expect(loader).toContain('validate_candidate_credentials');
    expect(loader).toContain('SKIP_RUNTIME_CREDENTIAL_SMOKE');
    expect(loader).toContain('SKIP_CLOUDFLARE_CREDENTIAL_SMOKE');
    expect(loader.indexOf('validate_candidate_credentials')).toBeLessThan(
      loader.indexOf('activate_current_projection "${release_name}"')
    );
  });

  it('defines a production topic without a subscription and registers its local emulator alias', () => {
    const terraform = readFileSync(terraformPath, 'utf8');
    const pubsubServer = readFileSync(pubsubServerPath, 'utf8');
    const pubsubUi = readFileSync(pubsubUiPath, 'utf8');
    const pubsubReadme = readFileSync(pubsubReadmePath, 'utf8');
    const pubsubPublishTest = readFileSync(pubsubPublishTestPath, 'utf8');
    const topic = 'intexuraos-runtime-credential-canary-dev';

    expect(terraform).toContain('module "pubsub_runtime_credential_canary"');
    expect(terraform).toContain('source = "../../modules/pubsub-topic"');
    expect(terraform).toContain('intexuraos-runtime-credential-canary-${var.environment}');
    expect(terraform).not.toMatch(/google_pubsub_subscription[^}]+runtime_credential_canary/su);
    expect(pubsubServer).toContain(`'${topic}'`);
    expect(pubsubServer).toContain(`'${topic}': null`);
    expect(pubsubUi.replace(/\s+/gu, ' ')).toContain(
      `<option value="${topic}"> ${topic} </option>`
    );
    expect(pubsubUi).toContain(`'${topic}': {`);
    expect(pubsubReadme).toContain(`\`${topic}\``);
    expect(pubsubPublishTest).toContain("'runtime-credential-canary': {");
    expect(pubsubPublishTest).toContain(`topic: '${topic}'`);
  });

  it('documents the non-mutating Cloudflare limitation and the fail-safe attestation procedure', () => {
    const operations = readFileSync(operationsPath, 'utf8').replace(/\s+/gu, ' ');

    expect(operations).toContain('Cloudflare DNS Edit attestation');
    expect(operations).toContain('cannot distinguish `DNS Read` from `DNS Edit`');
    expect(operations).toContain('prod-v<VERSION>.json');
    expect(operations).toContain('must stop before activation');
    expect(operations).toContain('24 hours');
    expect(operations).toContain('five minutes in the future');
  });
});
