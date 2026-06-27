import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WEB_APP_URL,
  buildWebAppHashUrl,
  normalizeWebAppUrl,
  resolveWebAppUrl,
} from '../webAppUrl.js';

describe('web app URL helpers', () => {
  it('uses the default web app URL when no base URL is provided', () => {
    expect(resolveWebAppUrl()).toBe(DEFAULT_WEB_APP_URL);
    expect(buildWebAppHashUrl('/#/notes/note-1')).toBe('https://intexuraos.cloud/#/notes/note-1');
  });

  it('uses the default web app URL when the provided base URL is empty', () => {
    expect(resolveWebAppUrl('')).toBe(DEFAULT_WEB_APP_URL);
    expect(resolveWebAppUrl('   ')).toBe(DEFAULT_WEB_APP_URL);
  });

  it('trims trailing slashes while preserving an explicit base URL', () => {
    expect(normalizeWebAppUrl('https://dev.intexuraos.cloud///')).toBe(
      'https://dev.intexuraos.cloud'
    );
    expect(resolveWebAppUrl('https://dev.intexuraos.cloud/')).toBe('https://dev.intexuraos.cloud');
  });

  it('builds hash URLs for routes with or without a leading slash', () => {
    expect(buildWebAppHashUrl('/#/bookmarks/bookmark-1', 'https://dev.intexuraos.cloud/')).toBe(
      'https://dev.intexuraos.cloud/#/bookmarks/bookmark-1'
    );
    expect(buildWebAppHashUrl('#/bookmarks/bookmark-1', 'https://dev.intexuraos.cloud/')).toBe(
      'https://dev.intexuraos.cloud/#/bookmarks/bookmark-1'
    );
  });
});
