/**
 * @vitest-environment node
 */

import { readFileSync } from 'node:fs';
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
    const actionConfigSource = readWebFile('config/action-config.yaml');
    const typeSource = readWebFile('types/index.ts');

    expect(actionConfigSource).not.toContain('approve_todo');
    expect(actionConfigSource).not.toContain('retry_todo');
    expect(actionConfigSource).not.toMatch(/^\s{2}todo:/m);
    expect(typeSource).not.toMatch(/^\s*\| 'todo'$/m);
  });
});
