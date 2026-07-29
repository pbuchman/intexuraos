/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  AUTH_RETURN_PATH_KEY,
  consumeAuthReturnPath,
  rememberAuthReturnPath,
} from '../authReturnPath.js';

describe('authReturnPath', () => {
  beforeEach(() => sessionStorage.clear());

  it('round-trips one exact internal legacy URL and consumes it once', () => {
    const returnTo =
      '/notifications/digests/grupa-wedkarska-skool/2026-07-27?source=legacy';
    rememberAuthReturnPath(returnTo);

    expect(sessionStorage.getItem(AUTH_RETURN_PATH_KEY)).toBe(returnTo);
    expect(consumeAuthReturnPath()).toBe(returnTo);
    expect(consumeAuthReturnPath()).toBeNull();
  });

  it.each([
    '',
    'login',
    '/login',
    '//external.test/path',
    'https://external.test/path',
    '/safe\tpath',
    '/safe\npath',
    '/safe\0path',
    '/safe\u001Fpath',
    '/safe\u007Fpath',
  ])(
    'rejects unsafe or recursive return path %s',
    (returnTo) => {
      rememberAuthReturnPath(returnTo);
      expect(sessionStorage.getItem(AUTH_RETURN_PATH_KEY)).toBeNull();
      sessionStorage.setItem(AUTH_RETURN_PATH_KEY, returnTo);
      expect(consumeAuthReturnPath()).toBeNull();
    }
  );
});
