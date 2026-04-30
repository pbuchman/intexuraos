import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultNodeEnv } from '../../bootstrap/node-env.js';

describe('defaultNodeEnv', () => {
  let original: string | undefined;

  beforeEach(() => {
    original = process.env['NODE_ENV'];
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env['NODE_ENV'];
    } else {
      process.env['NODE_ENV'] = original;
    }
  });

  it('sets NODE_ENV to development when unset', () => {
    delete process.env['NODE_ENV'];
    defaultNodeEnv();
    expect(process.env['NODE_ENV']).toBe('development');
  });

  it('leaves an explicitly-set NODE_ENV untouched', () => {
    process.env['NODE_ENV'] = 'production';
    defaultNodeEnv();
    expect(process.env['NODE_ENV']).toBe('production');
  });

  it('leaves an explicitly-set empty NODE_ENV untouched (only nullish triggers default)', () => {
    process.env['NODE_ENV'] = '';
    defaultNodeEnv();
    expect(process.env['NODE_ENV']).toBe('');
  });
});
