import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '..', '..');
const read = (path: string): string => readFileSync(resolve(repoRoot, path), 'utf8');

describe('WhatsApp Message Digest active documentation', () => {
  it('indexes the complete standalone service documentation set', () => {
    const serviceFiles = [
      'features.md',
      'technical.md',
      'tutorial.md',
      'agent.md',
      'technical-debt.md',
    ];
    const siteIndex = JSON.parse(read('docs/site-index.json')) as {
      documentation: { path: string }[];
    };
    const indexedPaths = new Set(siteIndex.documentation.map((entry) => entry.path));
    const catalog = read('docs/services/index.md');

    for (const file of serviceFiles) {
      const path = `docs/services/message-digest-service/${file}`;
      expect(existsSync(resolve(repoRoot, path)), path).toBe(true);
      expect(indexedPaths.has(`services/message-digest-service/${file}`), path).toBe(true);
    }
    expect(catalog).toContain('[message-digest-service](message-digest-service/features.md)');
    expect(catalog).toContain('WhatsApp group and direct-chat summaries');
  });

  it('assigns current digest ownership only to Message Digest and WhatsApp', () => {
    const mobileTechnical = read('docs/services/mobile-notifications-service/technical.md');
    const mobileAgent = read('docs/services/mobile-notifications-service/agent.md');
    const fishingTechnical = read('docs/services/fishing-assistant-service/technical.md');
    const fishingAgent = read('docs/services/fishing-assistant-service/agent.md');
    const whatsappTechnical = read('docs/services/whatsapp-service/technical.md');

    expect(mobileTechnical).not.toContain('/internal/notifications/digest');
    expect(mobileTechnical).not.toContain('DIGEST_LLM');
    expect(mobileAgent).not.toContain('/internal/notifications/digest');
    expect(fishingTechnical).toContain('message-digest-service');
    expect(fishingTechnical).not.toContain('INTEXURAOS_MOBILE_NOTIFICATIONS_SERVICE_URL');
    expect(fishingAgent).toContain('message-digest-service');
    expect(fishingAgent).not.toContain('mobile-notifications-service for digest');
    expect(whatsappTechnical).toContain('/internal/whatsapp/private/digest-source/validate');
    expect(whatsappTechnical).toContain('/internal/whatsapp/delivery-readiness/get');
    expect(whatsappTechnical).toContain('first mapped phone number');
  });

  it('keeps the repository entry points truthful about Mobile Notifications and Message Digests', () => {
    const readme = read('README.md');
    const overview = read('docs/overview.md');

    expect(readme).toContain(
      '[`message-digest-service`](docs/services/message-digest-service/features.md)'
    );
    expect(readme).toContain('WhatsApp group and direct-chat summaries');
    expect(readme).not.toContain(
      'Android notification capture and WhatsApp group digest generation.'
    );
    expect(overview).toContain(
      '**[Message Digest Service](services/message-digest-service/features.md)**'
    );
    expect(overview).toContain('WhatsApp group and direct-chat summaries');
    expect(overview).not.toContain(
      'WhatsApp group messages can also be processed into AI-generated daily digest summaries'
    );
  });

  it('documents the completed migration and current basic-stage limitation', () => {
    const runbookPath = 'docs/runbooks/whatsapp-message-digests.md';
    expect(existsSync(resolve(repoRoot, runbookPath))).toBe(true);
    const runbook = read(runbookPath);

    for (const contract of [
      'historical migration is complete',
      'Home PROD',
      'basic',
      '503',
      'message_digest_runs',
      'pull subscription',
      'production_scheduler_jobs_enabled=false',
    ]) {
      expect(runbook, contract).toContain(contract);
    }
    expect(runbook).not.toContain('cutover-message-digests.sh');
    expect(runbook).not.toMatch(/terraform\s+(?:plan|apply)|--activate|--compensate/u);
  });
});
