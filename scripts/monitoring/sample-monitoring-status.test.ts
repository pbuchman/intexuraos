import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  emptySummary,
  parseOptions,
  readProtectedToken,
  sanitizeStatus,
  updateSummary,
} from './sample-monitoring-status.js';

function payload(documents = 4): unknown {
  return {
    success: true,
    data: {
      schemaVersion: 1,
      observedAt: '2026-11-10T20:00:00.000Z',
      privateBody: 'private-body',
      jobs: [
        { key: 'private-id', lastOutcome: 'failed', lastStartedAt: '2026-11-10T19:59:00.000Z' },
      ],
      notifications: {
        pendingCount: 1,
        failedCount: 2,
        oldestPendingScheduledFor: '2026-11-10T19:00:00.000Z',
        lastDeliveredAt: 'private-text',
        privatePayload: 'private-payload',
      },
      firestoreMonitoring: {
        queryStarts: documents,
        transportStreamStarts: documents,
        documentReads: documents,
        documentRemoveEvents: 0,
        documentDeleteEvents: 0,
        receivedDocuments: documents,
        protobufDocumentBytes: documents * 100,
        listenResponseBytes: documents * 110,
        activeListeners: 2,
        readyListeners: 2,
        erroredListeners: 0,
        mode: 'incremental',
        privateKey: 'private-value',
      },
    },
  };
}

describe('postdeployment monitoring sampler', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it('emits only allowlisted diagnostics and aggregate functional state', () => {
    const result = sanitizeStatus(payload());
    expect(result?.metrics.documentReads).toBe(4);
    expect(result?.notifications).toEqual({
      pendingCount: 1,
      failedCount: 2,
      oldestPendingScheduledFor: '2026-11-10T19:00:00.000Z',
      lastDeliveredAt: null,
    });
    expect(result?.jobs).toMatchObject({ total: 1, failed: 1 });
    expect(JSON.stringify(result)).not.toMatch(/private|key|Body|Payload/);
    expect(sanitizeStatus({ success: false, error: 'private-error' })).toBeNull();
    expect(sanitizeStatus({ success: true, data: { schemaVersion: 1 } })).toBeNull();
  });

  it('distinguishes a steady-state delta from counters reset by a process restart', () => {
    const summary = emptySummary();
    const sample = (documents: number): Parameters<typeof updateSummary>[1] => ({
      service: 'digest',
      sampledAt: '2026-11-10T20:00:00.000Z',
      statusCode: 200,
      category: 'ok',
      state: sanitizeStatus(payload(documents)),
    });
    expect(updateSummary(summary, sample(4))).toEqual({ resetObserved: false, delta: null });
    expect(updateSummary(summary, sample(4)).delta?.documentReads).toBe(0);
    expect(updateSummary(summary, sample(7)).delta?.documentReads).toBe(3);
    expect(summary.observedCounterDelta?.documentReads).toBe(3);
    expect(updateSummary(summary, sample(2))).toMatchObject({ resetObserved: true });
    expect(summary.resetObservations).toBe(1);
    expect(summary.observedCounterDelta).toBeNull();
    expect(summary.cumulativeCounterIncreases.documentReads).toBe(5);
    expect(summary.minimumReadyListeners).toBe(2);
    updateSummary(summary, { ...sample(2), statusCode: 503, category: 'http_error', state: null });
    expect(summary.statusCodes).toEqual({ '200': 4, '503': 1 });
    expect(summary.samples).toBe(5);
    expect(summary.validSamples).toBe(4);
  });

  it('counts native stream recreation without document frames and requires its diagnostic field', () => {
    const summary = emptySummary();
    const initial = sanitizeStatus(payload(4));
    expect(initial).not.toBeNull();
    const input = payload(4) as { data: { firestoreMonitoring: Record<string, unknown> } };
    input.data.firestoreMonitoring['transportStreamStarts'] = 5;
    const reopened = sanitizeStatus(input);
    const sample = {
      service: 'digest' as const,
      sampledAt: '2026-11-10T20:00:00.000Z',
      statusCode: 200,
      category: 'ok' as const,
      state: initial,
    };
    updateSummary(summary, sample);
    const change = updateSummary(summary, { ...sample, state: reopened });
    expect(change.resetObserved).toBe(false);
    expect(change.delta?.transportStreamStarts).toBe(1);
    expect(change.delta?.documentReads).toBe(0);
    expect(summary.observedCounterDelta?.transportStreamStarts).toBe(1);
    expect(summary.cumulativeCounterIncreases.transportStreamStarts).toBe(1);
    delete input.data.firestoreMonitoring['transportStreamStarts'];
    expect(sanitizeStatus(input)).toBeNull();
    input.data.firestoreMonitoring['transportStreamStarts'] = -1;
    expect(sanitizeStatus(input)).toBeNull();
    input.data.firestoreMonitoring['transportStreamStarts'] = 'private-error';
    expect(sanitizeStatus(input)).toBeNull();
  });

  it('tracks required removal and deletion frame counters separately from received document bodies', () => {
    const summary = emptySummary();
    const sample = {
      service: 'digest' as const,
      sampledAt: '2026-11-10T20:00:00.000Z',
      statusCode: 200,
      category: 'ok' as const,
      state: sanitizeStatus(payload(4)),
    };
    updateSummary(summary, sample);
    const input = payload(4) as { data: { firestoreMonitoring: Record<string, unknown> } };
    input.data.firestoreMonitoring['documentRemoveEvents'] = 2;
    input.data.firestoreMonitoring['documentDeleteEvents'] = 1;
    input.data.firestoreMonitoring['listenResponseBytes'] = 449;
    const change = updateSummary(summary, { ...sample, state: sanitizeStatus(input) });
    expect(change.resetObserved).toBe(false);
    expect(change.delta).toMatchObject({
      documentRemoveEvents: 2,
      documentDeleteEvents: 1,
      receivedDocuments: 0,
      documentReads: 0,
      protobufDocumentBytes: 0,
      listenResponseBytes: 9,
    });
    expect(summary.cumulativeCounterIncreases.documentRemoveEvents).toBe(2);
    expect(summary.observedCounterDelta?.documentDeleteEvents).toBe(1);
    for (const field of ['documentRemoveEvents', 'documentDeleteEvents']) {
      for (const invalid of [undefined, -1, 0.5, 'private-error']) {
        const malformed = payload(4) as { data: { firestoreMonitoring: Record<string, unknown> } };
        malformed.data.firestoreMonitoring[field] = invalid;
        expect(sanitizeStatus(malformed)).toBeNull();
      }
    }
  });

  it('reads only a protected regular token file and rejects symlinks and multiline content', () => {
    const root = mkdtempSync(join(tmpdir(), 'monitoring-sampler-'));
    roots.push(root);
    const file = join(root, 'token');
    writeFileSync(file, 'fictional-test-token\n', { mode: 0o600 });
    expect(readProtectedToken(file)).toBe('fictional-test-token');
    chmodSync(file, 0o644);
    expect(() => readProtectedToken(file)).toThrow('INVALID_TOKEN_FILE');
    chmodSync(file, 0o600);
    const link = join(root, 'link');
    symlinkSync(file, link);
    expect(() => readProtectedToken(link)).toThrow();
    writeFileSync(file, 'token\nprivate-second-line');
    expect(() => readProtectedToken(file)).toThrow('INVALID_TOKEN_FILE');
  });

  it('defaults to a 20-minute window and validates finite polling bounds', () => {
    expect(parseOptions(['--token-file', '/protected/token'])).toEqual({
      tokenFile: '/protected/token',
      output: null,
      durationMs: 1200000,
      intervalMs: 15000,
    });
    expect(() => parseOptions(['--token', 'private-token'])).toThrow();
    expect(() =>
      parseOptions(['--token-file', '/protected/token', '--duration-seconds', 'NaN'])
    ).toThrow();
    expect(() =>
      parseOptions(['--token-file', '/protected/token', '--interval-seconds', '0'])
    ).toThrow();
  });
});
