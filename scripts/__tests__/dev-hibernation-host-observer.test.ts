import { describe, expect, it } from 'vitest';
import {
  evaluateAlloyFlushProof,
  parseAlloyDebugMetrics,
  runDevHostObservabilityObserver,
} from '../lib/dev-hibernation-drain-collector.mjs';
import type {
  AlloyDebugSnapshot,
  HostObservabilitySnapshot,
} from '../lib/dev-hibernation-drain-collector.mjs';

const runId = '20260828T002847Z-paddc4965d21e-b265702826912';
const nonce = 'b'.repeat(64);
const unitNames = [
  'pm2-pbuchman.service',
  'intexuraos-emulators.service',
  'pm2-journal-bridge.service',
  'intexuraos-log-viewer.service',
  'intexuraos-log-server.service',
  'alloy.service',
] as const;

function units(inactive: readonly string[] = []): HostObservabilitySnapshot['units'] {
  return Object.fromEntries(
    unitNames.map((name, index) => [
      name,
      inactive.includes(name)
        ? { activeState: 'inactive', invocationId: '', mainPid: 0 }
        : { activeState: 'active', invocationId: `${index + 1}`.repeat(32), mainPid: 100 + index },
    ])
  ) as HostObservabilitySnapshot['units'];
}

function alloy(lines = 2, bytes = 20, capturedAt = '2026-08-29T10:00:00Z'): AlloyDebugSnapshot {
  return {
    capturedAt,
    configSha256: 'c'.repeat(64),
    invocationId: '6'.repeat(32),
    mainPid: 105,
    pm2Only: true,
    source: {
      activeFilesTotal: 2,
      fileBytesTotal: bytes,
      readBytesTotal: bytes,
      readLinesTotal: lines,
    },
    write: {
      batchRetriesTotal: 0,
      droppedEntriesTotal: 0,
      sentEntriesTotal: lines,
    },
  };
}

function snapshot(
  phase: 'active' | 'terminal' | 'final',
  lineCount = phase === 'active' ? 2 : 4,
  capturedAt = '2026-08-29T10:00:00Z'
): HostObservabilitySnapshot {
  const inactive =
    phase === 'active'
      ? []
      : phase === 'terminal'
        ? ['pm2-pbuchman.service', 'intexuraos-emulators.service']
        : [
            'pm2-pbuchman.service',
            'intexuraos-emulators.service',
            'pm2-journal-bridge.service',
            'intexuraos-log-viewer.service',
            'intexuraos-log-server.service',
          ];
  return {
    alloy: alloy(lineCount, lineCount * 10, capturedAt),
    capturedAt,
    logServer: { childProcessCount: 0, clients: 0 },
    terminalTail: {
      complete: phase !== 'active',
      expectedMarkerCount: 2,
      observedMarkerCount: phase === 'active' ? 0 : 2,
    },
    units: units(inactive),
  };
}

describe('Alloy debug evidence', () => {
  it('defaults to two complete 10-second file-match cycles', () => {
    const baseline = alloy(1, 10, '2026-08-29T10:00:00Z');
    const first = alloy(2, 20, '2026-08-29T10:00:20Z');
    expect(
      evaluateAlloyFlushProof({
        baseline,
        expectedFileCount: 2,
        first,
        second: alloy(2, 20, '2026-08-29T10:00:30Z'),
      }).status
    ).toBe('UNKNOWN');
    expect(
      evaluateAlloyFlushProof({
        baseline,
        expectedFileCount: 2,
        first,
        second: alloy(2, 20, '2026-08-29T10:00:40Z'),
      }).status
    ).toBe('PASS');
  });

  it('derives zero pending entries only from the complete documented metric set', () => {
    const proof = evaluateAlloyFlushProof({
      baseline: alloy(1, 10),
      first: alloy(2, 20, '2026-08-29T10:00:02Z'),
      minimumStableIntervalMs: 2_000,
      second: alloy(2, 20, '2026-08-29T10:00:04Z'),
      expectedFileCount: 2,
    });
    expect(proof).toEqual({ pendingBufferCount: 0, reasons: [], status: 'PASS' });
  });

  it('rejects equal or too-close scrape timestamps even when counters are identical', () => {
    const sameTime = alloy(2, 20, '2026-08-29T10:00:02Z');
    expect(
      evaluateAlloyFlushProof({
        baseline: alloy(1, 10),
        first: sameTime,
        minimumStableIntervalMs: 2_000,
        second: sameTime,
        expectedFileCount: 2,
      }).status
    ).toBe('UNKNOWN');
    expect(
      evaluateAlloyFlushProof({
        baseline: alloy(1, 10),
        first: alloy(2, 20, '2026-08-29T10:00:02Z'),
        minimumStableIntervalMs: 2_000,
        second: alloy(2, 20, '2026-08-29T10:00:03Z'),
        expectedFileCount: 2,
      }).status
    ).toBe('UNKNOWN');
  });

  it('fails closed for a missing metric, discontinuity, drops, retries, or a nonzero queue', () => {
    const missing = structuredClone(alloy());
    // @ts-expect-error exercises runtime schema validation
    delete missing.source.readLinesTotal;
    expect(
      evaluateAlloyFlushProof({
        baseline: alloy(),
        first: missing,
        minimumStableIntervalMs: 2_000,
        second: missing,
        expectedFileCount: 2,
      }).status
    ).toBe('UNKNOWN');

    const queued = alloy(3, 30);
    queued.write.sentEntriesTotal = 2;
    expect(
      evaluateAlloyFlushProof({
        baseline: alloy(1, 10),
        first: { ...queued, capturedAt: '2026-08-29T10:00:02Z' },
        minimumStableIntervalMs: 2_000,
        second: { ...queued, capturedAt: '2026-08-29T10:00:04Z' },
        expectedFileCount: 2,
      })
    ).toMatchObject({ pendingBufferCount: 1, status: 'UNKNOWN' });
  });

  it('parses only complete real Alloy metric families and rejects a missing signal', () => {
    const metrics = [
      'loki_source_file_files_active_total{component_id="loki.source.file.pm2_logs"} 2',
      'loki_source_file_file_bytes_total{component_id="loki.source.file.pm2_logs",path="a"} 10',
      'loki_source_file_file_bytes_total{component_id="loki.source.file.pm2_logs",path="b"} 10',
      'loki_source_file_read_bytes_total{component_id="loki.source.file.pm2_logs",path="a"} 10',
      'loki_source_file_read_bytes_total{component_id="loki.source.file.pm2_logs",path="b"} 10',
      'loki_source_file_read_lines_total{component_id="loki.source.file.pm2_logs",path="a"} 1',
      'loki_source_file_read_lines_total{component_id="loki.source.file.pm2_logs",path="b"} 1',
      'loki_write_sent_entries_total{component_id="loki.write.grafana_cloud",endpoint="pm2_grafana_cloud"} 2',
      'loki_write_dropped_entries_total{component_id="loki.write.grafana_cloud",endpoint="pm2_grafana_cloud"} 0',
      'loki_write_batch_retries_total{component_id="loki.write.grafana_cloud",endpoint="pm2_grafana_cloud"} 0',
    ].join('\n');

    expect(parseAlloyDebugMetrics(metrics)).toEqual({
      source: {
        activeFilesTotal: 2,
        fileBytesTotal: 20,
        readBytesTotal: 20,
        readLinesTotal: 2,
      },
      write: { batchRetriesTotal: 0, droppedEntriesTotal: 0, sentEntriesTotal: 2 },
    });
    expect(() => parseAlloyDebugMetrics(metrics.replace(/loki_write_sent[^\n]+\n?/u, ''))).toThrow(
      /missing Alloy metric/u
    );
  });
});

describe('DEV host observability observer', () => {
  it('publishes preflight, terminal, and final evidence only after two stable proofs per phase', async () => {
    const snapshots = [
      snapshot('active', 2, '2026-08-29T10:00:00Z'),
      snapshot('active', 2, '2026-08-29T10:00:02Z'),
      snapshot('terminal', 4, '2026-08-29T10:00:04Z'),
      snapshot('terminal', 4, '2026-08-29T10:00:06Z'),
      snapshot('final', 4, '2026-08-29T10:00:08Z'),
      snapshot('final', 4, '2026-08-29T10:00:10Z'),
    ];
    const published: { fileName: string; value: Record<string, unknown> }[] = [];

    const result = await runDevHostObservabilityObserver({
      evidenceRunId: runId,
      getSnapshot: async () => snapshots.shift(),
      maxPolls: 6,
      maxSnapshotAgeMs: 15_000,
      minimumStableIntervalMs: 2_000,
      now: () => new Date('2026-08-29T10:00:12Z'),
      operationNonce: nonce,
      publish: async (publication) => {
        published.push(publication);
        return {
          ...publication,
          path: `/evidence/${publication.fileName}`,
          sha256: 'd'.repeat(64),
        };
      },
      sleep: async () => undefined,
    });

    expect(result.result).toBe('PASS');
    expect(published.map(({ fileName }) => fileName)).toEqual([
      `alloy-flush-${nonce}.json`,
      `terminal-log-tail-${nonce}.json`,
      `final-alloy-flush-${nonce}.json`,
    ]);
    expect(Object.keys(published[1].value)).toHaveLength(11);
    expect(Object.keys(published[2].value)).toHaveLength(11);
  });

  it('publishes no PASS fence when Alloy or unit continuity is unknown', async () => {
    const broken = snapshot('terminal', 4, '2026-08-29T10:00:04Z');
    broken.alloy.invocationId = '9'.repeat(32);
    const brokenLater = structuredClone(broken);
    brokenLater.capturedAt = '2026-08-29T10:00:06Z';
    brokenLater.alloy.capturedAt = brokenLater.capturedAt;
    const snapshots = [
      snapshot('active', 2, '2026-08-29T10:00:00Z'),
      snapshot('active', 2, '2026-08-29T10:00:02Z'),
      broken,
      brokenLater,
    ];
    const published: string[] = [];

    const result = await runDevHostObservabilityObserver({
      evidenceRunId: runId,
      getSnapshot: async () => snapshots.shift(),
      maxPolls: 4,
      maxSnapshotAgeMs: 15_000,
      minimumStableIntervalMs: 2_000,
      now: () => new Date('2026-08-29T10:00:08Z'),
      operationNonce: nonce,
      publish: async ({ fileName, value }) => {
        published.push(fileName);
        return { fileName, path: `/evidence/${fileName}`, sha256: 'd'.repeat(64), value };
      },
      sleep: async () => undefined,
    });

    expect(result.result).toBe('UNKNOWN');
    expect(published).toEqual([`alloy-flush-${nonce}.json`]);
  });
});
