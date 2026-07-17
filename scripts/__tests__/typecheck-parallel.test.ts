import { describe, expect, it } from 'vitest';
import { typecheckCommandArgs } from '../typecheck-parallel.mjs'; // @allow-missing-js -- .mjs import

describe('typecheck workspace execution', () => {
  it('uses pnpm filtering instead of recursively invoking the root typecheck script', () => {
    expect(typecheckCommandArgs('@intexuraos/intex-agent-evals')).toEqual([
      '--filter',
      '@intexuraos/intex-agent-evals',
      'run',
      'typecheck',
    ]);
  });
});
