import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(import.meta.dirname, '../..');
const runtimeRoot = resolve(repoRoot, 'terraform/prod-runtime');

function read(name: string): string {
  return readFileSync(resolve(runtimeRoot, name), 'utf8');
}

function topLevelKeys(source: string, localName: string): string[] {
  const start = source.indexOf(`  ${localName} = {`);
  expect(start).toBeGreaterThanOrEqual(0);
  const body = source.slice(start).split('\n  }\n', 1)[0] ?? '';
  return [...body.matchAll(/^    ([a-z0-9_]+) = \{$/gmu)].map((match) => match[1]);
}

function topLevelBlocks(source: string, localName: string): Map<string, string> {
  const start = source.indexOf(`  ${localName} = {`);
  expect(start).toBeGreaterThanOrEqual(0);
  const body = source.slice(start).split('\n  }\n', 1)[0] ?? '';
  const entries = [...body.matchAll(/^    ([a-z0-9_]+) = \{$/gmu)];
  return new Map(
    entries.map((entry, index) => [
      entry[1],
      body.slice(entry.index, entries[index + 1]?.index ?? body.length),
    ])
  );
}

describe('production runtime Terraform ownership', () => {
  it('uses the renamed Google-only root while retaining the production backend identity', () => {
    expect(existsSync(runtimeRoot)).toBe(true);
    expect(existsSync(resolve(repoRoot, 'terraform/hetzner-prod'))).toBe(false);
    expect(read('backend.tf')).toContain('prefix = "terraform/state/prod-hetzner"');

    const root = ['providers.tf', 'versions.tf', 'variables.tf', 'outputs.tf'].map(read).join('\n');
    expect(root).not.toMatch(/provider\s+"hcloud"|hetznercloud\/hcloud|hcloud_/u);
    expect(root).not.toContain('terraform_data');
    expect(root).not.toContain('local-exec');
    expect(existsSync(resolve(runtimeRoot, 'bootstrap.tf'))).toBe(false);
    expect(existsSync(resolve(runtimeRoot, 'cloud-init.yaml.tftpl'))).toBe(false);
    expect(existsSync(resolve(runtimeRoot, 'hetzner.tf'))).toBe(false);
    expect(existsSync(resolve(runtimeRoot, 'retired-async-cleanup.tf'))).toBe(false);
    const lockPath = resolve(runtimeRoot, '.terraform.lock.hcl');
    if (existsSync(lockPath)) {
      expect(readFileSync(lockPath, 'utf8')).not.toContain('hetznercloud/hcloud');
    }
  });

  it('retains exactly the seven Google recovery imports and no hcloud imports', () => {
    const imports = read('imports.tf');
    expect(imports.match(/^import \{$/gmu)).toHaveLength(7);
    expect(imports).not.toContain('hcloud_');
    expect([...imports.matchAll(/^  to = (.+)$/gmu)].map((match) => match[1])).toEqual([
      'google_pubsub_subscription.hetzner_push["whatsapp_media_cleanup"]',
      'google_pubsub_subscription.hetzner_push["whatsapp_webhook_process"]',
      'google_pubsub_subscription.hetzner_push["research_process"]',
      'google_pubsub_subscription.hetzner_push["llm_analytics"]',
      'google_pubsub_subscription.hetzner_push["llm_call"]',
      'google_pubsub_subscription.hetzner_push["bookmark_enrich"]',
      'google_pubsub_subscription.hetzner_push["bookmark_summarize"]',
    ]);
  });

  it('changes only the five unavailable consumers to pull delivery', () => {
    const pubsub = read('pubsub.tf');
    const subscriptionKeys = topLevelKeys(pubsub, 'hetzner_pubsub_push_subscriptions');
    expect(subscriptionKeys).toEqual([
      'message_digest_runs',
      'whatsapp_send',
      'whatsapp_media_cleanup',
      'whatsapp_webhook_process',
      'whatsapp_transcription_completed',
      'intex_message_ingest',
      'research_process',
      'llm_analytics',
      'llm_call',
      'bookmark_enrich',
      'bookmark_summarize',
      'pr_triage',
    ]);

    const subscriptions = topLevelBlocks(pubsub, 'hetzner_pubsub_push_subscriptions');
    const pullKeys = [...subscriptions]
      .filter(([, block]) => block.includes('delivery_mode         = "pull"'))
      .map(([key]) => key);
    expect(pullKeys).toEqual([
      'message_digest_runs',
      'research_process',
      'llm_analytics',
      'llm_call',
      'pr_triage',
    ]);
    expect(pubsub.match(/delivery_mode\s+= "push"/gu)).toHaveLength(7);
    for (const [, block] of subscriptions) {
      expect(block).not.toContain('filter');
    }
    expect(pubsub).toContain('for_each = each.value.delivery_mode == "push" ? [each.value] : []');
    expect(pubsub).toContain(
      'filter  = var.activate_hetzner_async_consumers ? null : local.pubsub_staging_filter'
    );
    expect(pubsub).toContain('name    = each.value.subscription_name');
    expect(pubsub).toContain('labels  = local.common_labels');
  });

  it('keeps compatibility filters active and pauses all fourteen schedulers independently', () => {
    const variables = read('variables.tf');
    const scheduler = read('scheduler.tf');
    const main = read('main.tf');

    expect(variables).toMatch(
      /variable "activate_hetzner_async_consumers" \{[\s\S]*?default\s+= true[\s\S]*?condition\s+= var\.activate_hetzner_async_consumers == true/u
    );
    expect(variables).toMatch(
      /variable "production_scheduler_jobs_enabled" \{[\s\S]*?default\s+= false/u
    );
    expect(main).toContain(
      'pubsub_staging_filter = "attributes.intexuraos_hetzner_cutover = \\"active\\""'
    );
    expect(topLevelKeys(scheduler, 'hetzner_scheduler_jobs')).toHaveLength(14);
    expect(scheduler).toContain('paused      = !var.production_scheduler_jobs_enabled');
    expect(scheduler).not.toContain('paused      = !var.activate_hetzner_async_consumers');
  });

  it('contains only runtime control inputs in the committed production values', () => {
    const variables = read('variables.tf');
    expect([...variables.matchAll(/^variable "([^"]+)" \{$/gmu)].map((match) => match[1])).toEqual([
      'project_id',
      'region',
      'environment',
      'source_environment',
      'hetzner_origin',
      'activate_hetzner_async_consumers',
      'production_scheduler_jobs_enabled',
      'labels',
    ]);

    const values = JSON.parse(read('prod.auto.tfvars.json')) as Record<string, unknown>;
    expect(Object.keys(values).sort()).toEqual(
      [
        'activate_hetzner_async_consumers',
        'environment',
        'hetzner_origin',
        'labels',
        'production_scheduler_jobs_enabled',
        'project_id',
        'region',
        'source_environment',
      ].sort()
    );
    expect(values.activate_hetzner_async_consumers).toBe(true);
    expect(values.production_scheduler_jobs_enabled).toBe(false);
  });
});
