import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadScenarioCatalog } from '../scenarioCatalog.js';

const trackedScenariosDirectory = fileURLToPath(new URL('../../scenarios/', import.meta.url));

describe('tracked scenario catalog', () => {
  it('validates every tracked scenario without network access', async () => {
    const scenarios = await loadScenarioCatalog(trackedScenariosDirectory);

    expect(scenarios).toEqual(expect.any(Array));
  });
});
