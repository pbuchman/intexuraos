import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '..', '..');
const firestoreTtlPath = resolve(repoRoot, 'terraform/modules/firestore/ttl.tf');

describe('Firestore TTL policies', () => {
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
