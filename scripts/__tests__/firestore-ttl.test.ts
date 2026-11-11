import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '..', '..');
const firestoreTtlPath = resolve(repoRoot, 'terraform/modules/firestore/ttl.tf');

describe('Firestore TTL policies', () => {
  it('uses a separate native Timestamp TTL field for durable notification records', () => {
    const terraform = readFileSync(firestoreTtlPath, 'utf8');
    const block = terraform.split('resource "google_firestore_field" "notification_ttl"')[1] ?? '';
    for (const name of [
      'whatsapp_notification_intents',
      'whatsapp_transport_receipts',
      'whatsapp_notification_markers',
    ])
      expect(block).toContain(name);
    expect(block).toContain('field      = "ttlExpiresAt"');
    expect(block).toContain('ttl_config {}');
  });
  it('configures the exact retained TTL collection groups, including Assistant snapshots', () => {
    const terraform = readFileSync(firestoreTtlPath, 'utf8');
    const localsBlock = terraform.slice(
      terraform.indexOf('ttl_collection_groups = ['),
      terraform.indexOf('\n  ]', terraform.indexOf('ttl_collection_groups = ['))
    );
    const collectionGroups = Array.from(localsBlock.matchAll(/"([^"]+)"/g), (match) => match[1]);

    expect(collectionGroups).toEqual([
      'github-webhook-audit-events',
      'github-pr-events',
      'github-event-log-entries',
      'code_review_events',
      'logs',
      'log_lines',
      'turn_metrics',
      'whatsapp_private_erasure_requests',
      'whatsapp_conversation_assistant_context_attachments',
      'whatsapp_conversation_assistant_context_chunks',
      'whatsapp_conversation_assistant_transcript_chunks',
    ]);
    expect(terraform).toContain('field      = "expireAt"');
    expect(terraform).toContain('ttl_config {}');
  });
});
