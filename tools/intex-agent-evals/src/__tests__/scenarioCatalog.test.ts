import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadScenarioCatalog } from '../scenarioCatalog.js';
import { createScenario } from './scenarioFixtures.js';

describe('loadScenarioCatalog', () => {
  let scenarioDirectory: string;

  beforeEach(() => {
    scenarioDirectory = mkdtempSync(join(tmpdir(), 'intex-agent-evals-'));
  });

  afterEach(() => {
    rmSync(scenarioDirectory, { recursive: true, force: true });
  });

  function writeScenario(filename: string, scenario: unknown): void {
    writeFileSync(join(scenarioDirectory, filename), JSON.stringify(scenario), 'utf8');
  }

  it('accepts an explicitly provided empty scenario directory', async () => {
    await expect(loadScenarioCatalog(scenarioDirectory)).resolves.toEqual([]);
  });

  it('loads scenarios deterministically by filename', async () => {
    writeScenario('intex-eval-002.scenario.json', createScenario(1, 'intex-eval-002'));
    writeScenario('intex-eval-001.scenario.json', createScenario(1, 'intex-eval-001'));

    const scenarios = await loadScenarioCatalog(scenarioDirectory);

    expect(scenarios.map((scenario) => scenario.id)).toEqual(['intex-eval-001', 'intex-eval-002']);
  });

  it('ignores non-scenario files and nested directories', async () => {
    writeFileSync(join(scenarioDirectory, 'README.md'), 'not scenario data', 'utf8');
    mkdirSync(join(scenarioDirectory, 'nested'));
    writeFileSync(
      join(scenarioDirectory, 'nested', 'intex-eval-002.scenario.json'),
      JSON.stringify(createScenario(1, 'intex-eval-002')),
      'utf8'
    );
    writeScenario('intex-eval-001.scenario.json', createScenario());

    const scenarios = await loadScenarioCatalog(scenarioDirectory);

    expect(scenarios.map((scenario) => scenario.id)).toEqual(['intex-eval-001']);
  });

  it('rejects malformed scenario JSON with the filename', async () => {
    writeFileSync(join(scenarioDirectory, 'intex-eval-001.scenario.json'), '{bad json', 'utf8');

    await expect(loadScenarioCatalog(scenarioDirectory)).rejects.toThrow(
      /Invalid JSON in "intex-eval-001\.scenario\.json"/
    );
  });

  it('rejects schema-invalid scenario JSON with the filename', async () => {
    const scenario = createScenario();
    scenario.schemaVersion = '2';
    writeScenario('intex-eval-001.scenario.json', scenario);

    await expect(loadScenarioCatalog(scenarioDirectory)).rejects.toThrow(
      /Invalid scenario "intex-eval-001\.scenario\.json"/
    );
  });

  it('rejects duplicate scenario IDs before filename mismatch checks', async () => {
    writeScenario('a.scenario.json', createScenario());
    writeScenario('b.scenario.json', createScenario());

    await expect(loadScenarioCatalog(scenarioDirectory)).rejects.toThrow(
      /Duplicate scenario id "intex-eval-001"/
    );
  });

  it('rejects filenames that do not equal the scenario ID', async () => {
    writeScenario('wrong.scenario.json', createScenario());

    await expect(loadScenarioCatalog(scenarioDirectory)).rejects.toThrow(
      /must be named "intex-eval-001\.scenario\.json"/
    );
  });
});
