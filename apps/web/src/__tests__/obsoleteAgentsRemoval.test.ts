/**
 * @vitest-environment node
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readWebFile(relativePath: string): string {
  return readFileSync(resolve(__dirname, '..', relativePath), 'utf-8');
}

const retiredAgentNames = ['todos', 'chat', 'cron'].map((prefix) => `${prefix}-agent`);
const retiredConfigFields = [
  ['todos', 'AgentUrl'],
  ['chat', 'AgentUrl'],
  ['cron', 'AgentUrl'],
].map(([prefix, suffix]) => `${prefix}${suffix}`);
const cronRoute = `/${['cron', 'agent'].join('-')}`;
const deletedHistoryFiles = [
  ['services', `${['command', 's'].join('')}Api.ts`],
  ['pages', 'InboxPage.tsx'],
  ['components', ['Action', 'Detail', 'Modal.tsx'].join('')],
  ['components', ['Action', 'Item.tsx'].join('')],
  ['components', ['Command', 'Detail', 'Modal.tsx'].join('')],
  ['components', ['Configurable', 'Action', 'Button.tsx'].join('')],
  ['hooks', ['use', 'Action', 'Config.ts'].join('')],
  ['hooks', ['use', 'Action', 'Changes.ts'].join('')],
  ['hooks', ['use', 'Command', 'Changes.ts'].join('')],
  ['services', ['action', 'Executor.ts'].join('')],
  ['services', ['condition', 'Evaluator.ts'].join('')],
  ['types', ['action', 'Config.ts'].join('')],
  ['config', ['action', 'config.yaml'].join('-')],
].map((parts) => parts.join('/'));

const removedServiceNames = ['command', 'action'].map((stem) => `${stem}s-${['agent'].join('')}`);
const removedServiceEnvSuffixes = ['COMMAND', 'ACTION'].map((stem) => `${stem}S_${['AGENT'].join('')}`);
const removedServiceUrlFields = ['command', 'action'].map((stem) => `${stem}sAgent${stem === 'command' ? 'Service' : ''}Url`);
const removedApiPaths = ['command', 'action'].map((stem) => `/api/${stem}s`);

describe('obsolete web agent removal', () => {
  it('keeps retired agent services out of the web manifest', () => {
    const manifest = JSON.parse(
      readFileSync(resolve(__dirname, '../../service-manifest.json'), 'utf-8')
    ) as { services: { name: string }[] };

    expect(manifest.services.map((service) => service.name)).not.toEqual(
      expect.arrayContaining(retiredAgentNames)
    );
  });

  it('keeps retired agent runtime config fields out of web config', () => {
    const configSource = readWebFile('config.ts');
    const typeSource = readWebFile('types/index.ts');

    for (const retiredField of retiredConfigFields) {
      expect(configSource).not.toContain(retiredField);
      expect(typeSource).not.toContain(retiredField);
    }
  });

  it('keeps retired routes and global chat mount out of App', () => {
    const appSource = readWebFile('App.tsx');

    expect(appSource).not.toContain('@/components/Chat');
    expect(appSource).not.toContain('@/pages/TodosListPage');
    expect(appSource).not.toContain(`@/pages${cronRoute}`);
    expect(appSource).not.toContain('path="/my-todos"');
    expect(appSource).not.toContain('path="/todos/:id"');
    expect(appSource).not.toContain(`path="${cronRoute}`);
    expect(appSource).not.toContain('<Chat />');
  });

  it('keeps retired nav entries out of the sidebar', () => {
    const sidebarSource = readWebFile('components/Sidebar.tsx');
    const navItemsSource = readWebFile('components/sidebar/navItems.ts');

    expect(sidebarSource).not.toContain(['Cron', 'Agent'].join(' '));
    expect(sidebarSource).not.toContain('/my-todos');
    expect(navItemsSource).not.toContain(['cron', 'AgentItems'].join(''));
    expect(navItemsSource).not.toContain(cronRoute);
  });

  it('keeps retired todo action flow out of command/action metadata', () => {
    const typeSource = readWebFile('types/index.ts');

    expect(typeSource).not.toMatch(/^\s*\| 'todo'$/m);
  });

  it('keeps retired history UI, listeners, config, and service wiring out of web', () => {
    const appSource = readWebFile('App.tsx');
    const sidebarSource = readWebFile('components/Sidebar.tsx');
    const configSource = readWebFile('config.ts');
    const typeSource = readWebFile('types/index.ts');
    const servicesSource = readWebFile('services/index.ts');
    const hooksSource = readWebFile('hooks/index.ts');
    const manifest = JSON.parse(
      readFileSync(resolve(__dirname, '../../service-manifest.json'), 'utf-8')
    ) as { services: { name: string; envSuffix: string; apiPath: string }[] };

    for (const relativePath of deletedHistoryFiles) {
      expect(existsSync(resolve(__dirname, '..', relativePath))).toBe(false);
    }

    expect(appSource).not.toContain(['path="/', 'inbox', '"'].join(''));
    expect(appSource).toContain('to="/intex-agent/sessions"');
    expect(sidebarSource).not.toContain(['to="/', 'inbox', '"'].join(''));

    expect(manifest.services.map((service) => service.name)).not.toEqual(
      expect.arrayContaining(removedServiceNames)
    );
    expect(manifest.services.map((service) => service.envSuffix)).not.toEqual(
      expect.arrayContaining(removedServiceEnvSuffixes)
    );
    expect(manifest.services.map((service) => service.apiPath)).not.toEqual(
      expect.arrayContaining(removedApiPaths)
    );

    for (const removedField of removedServiceUrlFields) {
      expect(configSource).not.toContain(removedField);
      expect(typeSource).not.toContain(removedField);
    }
    expect(servicesSource).not.toContain(`${['command', 's'].join('')}Api`);
    expect(hooksSource).not.toContain(['use', 'Action', 'Changes'].join(''));
    expect(hooksSource).not.toContain(['use', 'Command', 'Changes'].join(''));
  });

  it('keeps retired inbox, voice transcription, and action approval copy out of homepage sections', () => {
    const homepageSources = [
      'components/home/HeroShowcase.tsx',
      'components/home/GettingStartedSection.tsx',
      'components/home/SelfBuildingSection.tsx',
      'components/home/StatsSection.tsx',
      'components/home/VoiceSection.tsx',
    ].map((relativePath) => readWebFile(relativePath));
    const homepageSource = homepageSources.join('\n');

    expect(homepageSource).not.toContain('Inbox');
    expect(homepageSource).not.toContain('Voice note');
    expect(homepageSource).not.toContain('Transcription');
    expect(homepageSource).not.toContain('Ready to implement?');
    expect(homepageSource).not.toContain('User taps Implement');
    expect(homepageSource).not.toContain('Type or speak your first command');
    expect(homepageSource).not.toContain('You Approve Before It Runs');
    expect(homepageSource).not.toContain('High-stakes actions before they execute');
    expect(homepageSource).not.toContain('Action Types');
  });
});
