import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildLocalEmulatorStartPlan } from '../lib/local-emulator-lifecycle.mjs';

const root = resolve(__dirname, '../..');
describe('Message Digest local Firestore', () => {
  it('starts healthy Firestore alongside Pub/Sub before bootstrapping the bridge', () => {
    expect(buildLocalEmulatorStartPlan()[0]).toEqual([
      'up',
      '-d',
      '--wait',
      'firestore-emulator',
      'pubsub-emulator',
    ]);
  });
  it('persists snapshots across container recreation and binds only to loopback', () => {
    const compose = readFileSync(resolve(root, 'docker/docker-compose.local.yaml'), 'utf8');
    expect(compose).toContain('127.0.0.1:8101:8101');
    expect(compose).toContain('firestore-data:/data');
    expect(compose).toContain('stop_signal: SIGTERM');
    const startup = readFileSync(resolve(root, 'docker/firestore/start.sh'), 'utf8');
    expect(startup).toContain('/emulator/v1/projects/${project}:export');
    expect(startup).toContain('--seed_from_export=/data/current/firestore.overall_export_metadata');
    expect(startup).toContain('intexuraos-message-digest-mvp-local');
  });
});
