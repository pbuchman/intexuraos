import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  resolvePubSubProjectId,
  resolvePubSubProjectIds,
} from '../../tools/pubsub-ui/pubsub-forwarding.mjs';

const repoRoot = resolve(__dirname, '..', '..');
const smokeScript = readFileSync(resolve(repoRoot, 'scripts/pubsub-publish-test.mjs'), 'utf8');
const pubsubServer = readFileSync(resolve(repoRoot, 'tools/pubsub-ui/server.mjs'), 'utf8');
const pubsubUi = readFileSync(resolve(repoRoot, 'tools/pubsub-ui/index.html'), 'utf8');
const readme = readFileSync(resolve(repoRoot, 'tools/pubsub-ui/README.md'), 'utf8');

describe('Message Digest local Pub/Sub registration', () => {
  it('keeps the Message Digest topic in its isolated emulator project', () => {
    expect(resolvePubSubProjectId('message-digest-runs', {})).toBe(
      'intexuraos-message-digest-mvp-local'
    );
    expect(
      resolvePubSubProjectId('message-digest-runs', {
        PUBSUB_PROJECT_ID: 'shared-local-project',
        MESSAGE_DIGEST_PUBSUB_PROJECT_ID: 'isolated-digest-project',
      })
    ).toBe('isolated-digest-project');
    expect(
      resolvePubSubProjectId('whatsapp-send-message', {
        PUBSUB_PROJECT_ID: 'shared-local-project',
        MESSAGE_DIGEST_PUBSUB_PROJECT_ID: 'isolated-digest-project',
      })
    ).toBe('shared-local-project');
    expect(
      resolvePubSubProjectIds('whatsapp-send-message', {
        PUBSUB_PROJECT_ID: 'shared-local-project',
        MESSAGE_DIGEST_PUBSUB_PROJECT_ID: 'isolated-digest-project',
      })
    ).toEqual(['shared-local-project', 'isolated-digest-project']);
    expect(
      resolvePubSubProjectIds('message-digest-runs', {
        PUBSUB_PROJECT_ID: 'shared-local-project',
        MESSAGE_DIGEST_PUBSUB_PROJECT_ID: 'isolated-digest-project',
      })
    ).toEqual(['isolated-digest-project']);
  });

  it('registers one canonical topic and service forwarder everywhere', () => {
    expect(pubsubServer).toContain("'message-digest-runs'");
    expect(pubsubServer).toContain(
      "'message-digest-runs': 'http://host.docker.internal:8135/internal/message-digests/pubsub/run'"
    );
    expect(pubsubUi).toContain('<option value="message-digest-runs">message-digest-runs</option>');
    expect(readme).toContain('`message-digest-runs`');
    expect(readme).toContain('/internal/message-digests/pubsub/run');
  });

  it('publishes a canonical recipient-free smoke event', () => {
    expect(smokeScript).toContain("'message-digest-run': {");
    expect(smokeScript).toContain("topic: 'message-digest-runs'");
    expect(smokeScript).toContain("type: 'message-digest.run'");
    expect(smokeScript).toContain("definitionId: 'md_test-digest-001'");
    expect(smokeScript).toContain("runId: 'mdr_test-run-001'");

    const digestEvent = smokeScript.slice(
      smokeScript.indexOf("'message-digest-run': {"),
      smokeScript.indexOf("'message-digest-run': {") + 700
    );
    expect(digestEvent).not.toContain('recipient');
    expect(digestEvent).not.toContain('phoneNumber');
  });
});
