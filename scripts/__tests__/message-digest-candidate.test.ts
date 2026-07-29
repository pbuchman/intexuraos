import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  verifyMessageDigestCandidate,
  type MessageDigestCandidateInput,
} from '../hetzner/verify-message-digest-candidate.mjs';
import { deterministicDefinitionId } from '../message-digests/fishing-group-migration.mjs';

const MIGRATION_ID = `mdm_${'a'.repeat(40)}`;
const DEFINITION_ID = deterministicDefinitionId(MIGRATION_ID);
const OWNER_USER_ID = 'private-owner-sentinel';
const INTERNAL_AUTH_TOKEN = 'private-auth-sentinel';
const SERVICE_PORTS = {
  whatsapp: 18113,
  mobileNotifications: 18114,
  fishingAssistant: 18119,
  messageDigest: 18135,
} as const;

const temporaryDirectories: string[] = [];

interface CandidateFixture {
  webRoot: string;
  verifyReportPath: string;
  input: MessageDigestCandidateInput;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('Message Digest live candidate verifier', () => {
  it.each(['staged', 'active'] as const)(
    'verifies the complete %s service, visibility, zero-send, and isolated Web contract',
    async (phase) => {
      const fixture = candidateFixture(phase);
      const calls: { url: string; init?: RequestInit }[] = [];
      const fetchImplementation = candidateFetch(phase, calls);

      const result = await verifyMessageDigestCandidate(fixture.input, {
        fetchImplementation,
      });

      expect(result).toEqual({
        ok: true,
        phase,
        checkedServices: 4,
        checkedAssets: 2,
      });
      for (const port of Object.values(SERVICE_PORTS)) {
        expect(calls.some((call) => call.url === `http://127.0.0.1:${String(port)}/health`)).toBe(
          true
        );
      }
      const protectedCalls = calls.filter((call) => call.url.includes('/internal/'));
      expect(protectedCalls.length).toBeGreaterThanOrEqual(6);
      for (const call of protectedCalls) {
        expect(new Headers(call.init?.headers).get('x-internal-auth')).toBe(INTERNAL_AUTH_TOKEN);
      }
      const cutoverCalls = protectedCalls.filter((call) => call.url.includes('/cutover/check'));
      for (const call of cutoverCalls) {
        expect(new Headers(call.init?.headers).get('x-internal-caller-role')).toBe(
          'message_digest_cutover_verifier'
        );
      }
      const visibilityCall = cutoverCalls.find((call) =>
        call.url.includes('/internal/message-digests/cutover/check')
      );
      expect(JSON.parse(String(visibilityCall?.init?.body))).toMatchObject({
        ownerUserId: OWNER_USER_ID,
        definitionId: DEFINITION_ID,
      });
      const publicAuthCall = calls.find(
        (call) => new URL(call.url).pathname === `/${DEFINITION_ID}`
      );
      expect(publicAuthCall).toBeDefined();
      expect(new Headers(publicAuthCall?.init?.headers).get('authorization')).toBe(
        'Bearer message-digest-cutover-invalid'
      );
      expect(JSON.stringify(result)).not.toContain(OWNER_USER_ID);
      expect(JSON.stringify(result)).not.toContain(INTERNAL_AUTH_TOKEN);
    }
  );

  it.each([
    'health',
    'content-type',
    'message-digest',
    'public-auth',
    'fishing',
    'mobile',
    'scheduler',
    'scheduler-extra',
    'pubsub',
    'web-asset',
    'report',
    'network',
  ] as const)('fails closed when the %s contract is missing or malformed', async (target) => {
    const fixture = candidateFixture('staged');
    if (target === 'web-asset') {
      rmSync(resolve(fixture.webRoot, 'assets/app.js'));
    }
    if (target === 'report') {
      const verifyReport = JSON.parse(readFixtureReport(fixture.verifyReportPath)) as Record<
        string,
        unknown
      >;
      (verifyReport['counts'] as Record<string, unknown>)['outboundEffects'] = 1;
      writeFileSync(fixture.verifyReportPath, JSON.stringify(verifyReport), 'utf8');
    }

    await expect(
      verifyMessageDigestCandidate(fixture.input, {
        fetchImplementation: candidateFetch('staged', [], target),
      })
    ).rejects.toThrow(/^MESSAGE_DIGEST_CANDIDATE_[A-Z_]+$/u);
  });

  it('bounds response bodies and never exposes identities, tokens, URLs, or response content', async () => {
    const fixture = candidateFixture('staged');
    const protectedResponse = `${OWNER_USER_ID}:${INTERNAL_AUTH_TOKEN}:private-response-content`;
    const fetchImplementation = candidateFetch('staged', [], 'private-response', protectedResponse);

    let observed = '';
    try {
      await verifyMessageDigestCandidate(fixture.input, { fetchImplementation });
    } catch (error) {
      observed = String(error);
    }

    expect(observed).toMatch(/^Error: MESSAGE_DIGEST_CANDIDATE_[A-Z_]+$/u);
    expect(observed).not.toContain(OWNER_USER_ID);
    expect(observed).not.toContain(INTERNAL_AUTH_TOKEN);
    expect(observed).not.toContain('private-response-content');
    expect(observed).not.toContain('127.0.0.1');
  });
});

function candidateFixture(phase: 'staged' | 'active'): CandidateFixture {
  const directory = mkdtempSync(resolve(tmpdir(), 'message-digest-candidate-'));
  temporaryDirectories.push(directory);
  const webRoot = resolve(directory, 'web');
  mkdirSync(resolve(webRoot, 'assets'), { recursive: true });
  writeFileSync(
    resolve(webRoot, 'index.html'),
    '<!doctype html><script type="module" src="/assets/app.js"></script><link rel="manifest" href="/manifest.webmanifest">',
    'utf8'
  );
  writeFileSync(resolve(webRoot, 'assets/app.js'), 'globalThis.__candidate = true;', 'utf8');
  writeFileSync(resolve(webRoot, 'manifest.webmanifest'), '{"name":"Candidate"}', 'utf8');

  const dryRunReportPath = writeReport(directory, 'dry-run.json', {
    mode: 'dry-run',
    migrationId: MIGRATION_ID,
    status: 'ready',
    replayStartDate: '2026-07-04',
    replayEndDate: '2026-07-27',
    counts: { replayDates: 24, visibleReplayRuns: 23, outboundEffects: 0 },
  });
  const applyReportPath = writeReport(directory, 'apply.json', {
    mode: 'apply',
    migrationId: MIGRATION_ID,
    status: 'staged',
    replayStartDate: '2026-07-04',
    replayEndDate: '2026-07-27',
    counts: {
      replayRuns: 24,
      visibleReplayRuns: 23,
      canonicalRuns: 143,
      outboundEffects: 0,
    },
  });
  const verifyReportPath = writeReport(directory, 'verify.json', {
    mode: 'verify',
    migrationId: MIGRATION_ID,
    status: phase === 'staged' ? 'verified_staging' : 'verified_active',
    replayStartDate: '2026-07-04',
    replayEndDate: '2026-07-27',
    counts: {
      replayRuns: 24,
      visibleReplayRuns: 23,
      canonicalRuns: 143,
      outboundEffects: 0,
      publicDefinitions: phase === 'staged' ? 0 : 1,
      publicRuns: phase === 'staged' ? 0 : 143,
      fishingDefinitions: phase === 'staged' ? 0 : 1,
      fishingRuns: phase === 'staged' ? 0 : 143,
    },
  });
  const activationReportPath =
    phase === 'active'
      ? writeReport(directory, 'activate.json', {
          mode: 'activate',
          migrationId: MIGRATION_ID,
          status: 'active',
          replayStartDate: '2026-07-04',
          replayEndDate: '2026-07-27',
          counts: { canonicalRuns: 143, outboundEffects: 0 },
        })
      : undefined;

  return {
    webRoot,
    verifyReportPath,
    input: {
      phase,
      ports: SERVICE_PORTS,
      internalAuthToken: INTERNAL_AUTH_TOKEN,
      ownerUserId: OWNER_USER_ID,
      migrationId: MIGRATION_ID,
      webRoot,
      reports: {
        dryRun: dryRunReportPath,
        apply: applyReportPath,
        verify: verifyReportPath,
        ...(activationReportPath === undefined ? {} : { activation: activationReportPath }),
      },
    },
  };
}

function candidateFetch(
  phase: 'staged' | 'active',
  calls: { url: string; init?: RequestInit }[],
  failure?:
    | 'health'
    | 'content-type'
    | 'message-digest'
    | 'public-auth'
    | 'fishing'
    | 'mobile'
    | 'scheduler'
    | 'scheduler-extra'
    | 'pubsub'
    | 'network'
    | 'private-response',
  protectedResponse = ''
): typeof fetch {
  let schedulerCalls = 0;
  return (async (resource: string | URL | Request, init?: RequestInit) => {
    const url = String(resource);
    calls.push({ url, ...(init === undefined ? {} : { init }) });
    const parsed = new URL(url);
    const port = Number(parsed.port);
    if (!Object.values(SERVICE_PORTS).includes(port as never)) return await fetch(resource, init);
    if (failure === 'network' && parsed.pathname === '/health') {
      throw new Error(`${protectedResponse}:private-network-failure`);
    }
    if (parsed.pathname === '/health') {
      const serviceNames: Record<number, string> = {
        [SERVICE_PORTS.whatsapp]: 'whatsapp-service',
        [SERVICE_PORTS.mobileNotifications]: 'mobile-notifications-service',
        [SERVICE_PORTS.fishingAssistant]: 'fishing-assistant-service',
        [SERVICE_PORTS.messageDigest]: 'message-digest-service',
      };
      const health = {
        status: failure === 'health' && port === SERVICE_PORTS.whatsapp ? 'degraded' : 'ok',
        serviceName: serviceNames[port],
        version: '1.0.0',
        timestamp: '2026-07-29T12:00:00.000Z',
        checks: [],
      };
      return failure === 'content-type' && port === SERVICE_PORTS.whatsapp
        ? new Response(JSON.stringify(health), {
            status: 200,
            headers: { 'content-type': 'text/plain' },
          })
        : jsonResponse(health);
    }
    if (parsed.pathname === '/internal/message-digests/cutover/check') {
      if (failure === 'private-response') {
        return new Response(protectedResponse, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return jsonResponse({
        success: true,
        data: {
          ownerDefinitionVisible: failure === 'message-digest' ? true : phase === 'active',
          foreignDefinitionVisible: false,
        },
      });
    }
    if (parsed.pathname === `/${DEFINITION_ID}`) {
      return failure === 'public-auth'
        ? jsonResponse({ success: true, data: { forbidden: true } })
        : jsonResponse(
            { success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } },
            401
          );
    }
    if (parsed.pathname === '/internal/fishing-assistant/message-digests/cutover/check') {
      return jsonResponse({
        success: true,
        data: {
          definitionCount: phase === 'active' ? 1 : 0,
          runCount: failure === 'fishing' ? 99 : phase === 'active' ? 23 : 0,
        },
      });
    }
    if (parsed.pathname === '/internal/mobile-notifications/query') {
      return jsonResponse({
        success: true,
        data: { notifications: failure === 'mobile' ? 'invalid' : [] },
      });
    }
    if (parsed.pathname === '/internal/message-digests/scheduler/tick') {
      schedulerCalls += 1;
      return jsonResponse({
        success: true,
        data: {
          ok: true,
          recoveredDispatches: 0,
          reconciledDeliveries: 0,
          reservedRuns: failure === 'scheduler' && schedulerCalls === 2 ? 1 : 0,
          deferredDefinitions: 0,
          nextCursor: null,
          ...(failure === 'scheduler-extra' ? { privateField: 'forbidden' } : {}),
        },
      });
    }
    if (parsed.pathname === '/internal/message-digests/pubsub/run') {
      return failure === 'pubsub'
        ? jsonResponse({ success: true, data: { accepted: true } })
        : jsonResponse(
            { success: false, error: { code: 'INVALID_REQUEST', message: 'Invalid request' } },
            400
          );
    }
    return jsonResponse({ success: false, error: { code: 'NOT_FOUND' } }, 404);
  }) as typeof fetch;
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function writeReport(directory: string, name: string, value: unknown): string {
  const path = resolve(directory, name);
  writeFileSync(path, JSON.stringify(value), 'utf8');
  return path;
}

function readFixtureReport(path: string): string {
  return readFileSync(path, 'utf8');
}
