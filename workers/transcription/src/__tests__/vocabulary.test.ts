import { describe, expect, it } from 'vitest';

import { ADDITIONAL_VOCAB } from '../providers/speechmatics/vocabulary.js';

describe('Speechmatics custom vocabulary', () => {
  it('does not include retired service names or hints', () => {
    const removedTerms = ['command', 'action'].flatMap((stem) => [
      `${stem}s-agent`,
      `${stem}s agent`,
    ]);
    const serialized = JSON.stringify(ADDITIONAL_VOCAB);

    for (const term of removedTerms) {
      expect(serialized).not.toContain(term);
    }
  });
});
