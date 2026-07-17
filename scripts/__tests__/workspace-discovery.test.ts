import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  discoverWorkspaceDirectories,
  discoverWorkspaceNames,
} from '../lib/workspace-discovery.mjs'; // @allow-missing-js -- .mjs import

describe('workspace discovery', () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'workspace-discovery-'));
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  function addPackage(
    relativeDirectory: string,
    name: string,
    scripts: Record<string, string> = {}
  ): string {
    const directory = join(workspaceRoot, relativeDirectory);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'package.json'), JSON.stringify({ name, scripts }), 'utf8');
    return directory;
  }

  it('discovers wildcard workspaces and the concrete evaluator workspace', () => {
    const app = addPackage('apps/example-app', '@intexuraos/example-app');
    const evaluator = addPackage('tools/intex-agent-evals', '@intexuraos/intex-agent-evals');
    addPackage('tools/ignored-tool', 'ignored-tool');

    expect(
      discoverWorkspaceDirectories(workspaceRoot, [
        'apps/*',
        'packages/*',
        'workers/*',
        'tools/intex-agent-evals',
      ])
    ).toEqual([app, evaluator]);
  });

  it('ignores directories without package.json and missing workspace paths', () => {
    mkdirSync(join(workspaceRoot, 'apps', 'not-a-package'), { recursive: true });

    expect(
      discoverWorkspaceDirectories(workspaceRoot, [
        'apps/*',
        'packages/*',
        'tools/intex-agent-evals',
      ])
    ).toEqual([]);
  });

  it('returns only packages that declare the requested script', () => {
    addPackage('apps/linted', '@intexuraos/linted', { 'lint:local': 'eslint src' });
    addPackage('apps/not-linted', '@intexuraos/not-linted', { typecheck: 'tsc --noEmit' });
    addPackage('tools/intex-agent-evals', '@intexuraos/intex-agent-evals', {
      'lint:local': 'eslint src',
    });

    expect(
      discoverWorkspaceNames(workspaceRoot, ['apps/*', 'tools/intex-agent-evals'], 'lint:local')
    ).toEqual(['@intexuraos/linted', '@intexuraos/intex-agent-evals']);
  });
});
