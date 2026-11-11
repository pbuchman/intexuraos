import { describe, expect, it } from 'vitest';
import type { DocumentSnapshot, Firestore } from 'firebase-admin/firestore';
import {
  emptyMetrics,
  measureBaseline,
  parseArguments,
  protobufDocumentBytes,
  recordDocument,
} from './firestore-monitoring-measure.js';

interface FakeQueryResult {
  docs: DocumentSnapshot[];
  size: number;
  empty: boolean;
}
interface FakeQuery {
  where(...args: unknown[]): FakeQuery;
  get(): Promise<FakeQueryResult>;
  doc(): { get(): Promise<{ exists: false }> };
}

function document(data: Record<string, unknown>): DocumentSnapshot {
  return {
    exists: true,
    data: () => data,
    toDocumentProto: () => ({
      name: 'projects/test/databases/(default)/documents/a/b',
      fields: { status: { stringValue: 'failed' } },
    }),
  } as unknown as DocumentSnapshot;
}

describe('read-only monitoring measurement', () => {
  it('encodes the Firestore Document wire format and emits only safe operational metadata', () => {
    const snapshot = document({
      status: 'failed',
      userId: 'private-user',
      body: 'private-message',
      arbitraryPrivateField: 'private-value',
      createdAt: '2026-11-10T00:00:00.000Z',
      scheduledFor: 'private-non-timestamp',
    });
    // 47-byte encoded name + 23-byte map entry, independently known fixture.
    expect(protobufDocumentBytes(snapshot)).toBe(70);
    const metrics = emptyMetrics();
    recordDocument(metrics, snapshot);
    expect(metrics.returnedDocuments).toBe(1);
    expect(metrics.statusCounts['status']).toEqual({ failed: 1 });
    expect(metrics.timestampRanges['createdAt']).toEqual({
      min: '2026-11-10T00:00:00.000Z',
      max: '2026-11-10T00:00:00.000Z',
    });
    expect(JSON.stringify(metrics)).not.toMatch(/private|arbitraryPrivateField|userId|body/);
    expect(() => protobufDocumentBytes({ exists: true } as DocumentSnapshot)).toThrow(
      'UNSUPPORTED_DOCUMENT_PROTO_API'
    );
  });

  it('keeps actual documents separate from empty-query and missing-point read estimates', async () => {
    const predicates: [string, unknown[]][] = [];
    const data: Record<string, DocumentSnapshot[]> = {
      message_digest_definitions: [
        document({ userId: 'private-user', definitionId: 'private-def' }),
      ],
      message_digest_runs: [document({ generationStatus: 'generated' })],
      calendar_schedules: [document({ status: 'active' })],
      calendar_schedule_runs: [document({ deliveryStatus: 'delivered' })],
      whatsapp_notification_intents: [document({ dispatchStatus: 'accepted' })],
      whatsapp_notification_markers: [],
    };
    const db = {
      collection: (name: string): FakeQuery => {
        const query: FakeQuery = {
          where: (...args: unknown[]): FakeQuery => {
            predicates.push([name, args]);
            return query;
          },
          get: async (): Promise<FakeQueryResult> => {
            const docs = data[name] ?? [];
            return { docs, size: docs.length, empty: docs.length === 0 };
          },
          doc: (): { get(): Promise<{ exists: false }> } => ({
            get: async (): Promise<{ exists: false }> => ({ exists: false }),
          }),
        };
        return query;
      },
    } as unknown as Firestore;
    const result = await measureBaseline(db, '2026-11-10T00:00:00.000Z');
    expect(result.totals).toEqual({
      returnedDocuments: 5,
      protobufDocumentBytes: 350,
      queryRequests: 6,
      emptyQueryRequests: 1,
      pointReadRequests: 14,
      missingPointReads: 14,
      estimatedMinimumDocumentReads: 20,
    });
    expect(predicates).toContainEqual([
      'message_digest_runs',
      ['visibilityMigrationId', '==', null],
    ]);
    expect(predicates).toContainEqual([
      'calendar_schedule_runs',
      ['scheduledFor', '>=', '2026-11-03T00:00:00.000Z'],
    ]);
    expect(predicates).toContainEqual([
      'whatsapp_notification_intents',
      ['expiresAt', '>', 1794268800],
    ]);
    expect(JSON.stringify(result)).not.toContain('private');
  });

  it('requires the fixed project and explicit production read authorization', () => {
    const args = ['--project', 'intexuraos-dev-pbuchman', '--allow-production-reads'];
    expect(parseArguments([...args, '--at', '2026-11-10T00:00:00.000Z'])).toEqual({
      projectId: 'intexuraos-dev-pbuchman',
      observedAt: '2026-11-10T00:00:00.000Z',
    });
    expect(() => parseArguments(args.slice(0, 2))).toThrow();
    expect(() =>
      parseArguments(['--project', 'other-project', '--allow-production-reads'])
    ).toThrow();
    expect(() => parseArguments([...args, '--at', 'not-a-time'])).toThrow();
    expect(() => parseArguments([...args, '--write'])).toThrow();
  });
});
