import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildCodeTaskUrl,
  normalizeWebAppUrl,
  resolveConfiguredWebAppUrl,
} from '../../../domain/utils/taskUrls.js';

describe('task URL helpers', () => {
  let originalWebAppUrl: string | undefined;

  beforeEach(() => {
    originalWebAppUrl = process.env['INTEXURAOS_WEB_APP_URL'];
  });

  afterEach(() => {
    if (originalWebAppUrl === undefined) {
      delete process.env['INTEXURAOS_WEB_APP_URL'];
    } else {
      process.env['INTEXURAOS_WEB_APP_URL'] = originalWebAppUrl;
    }
  });

  it('normalizes a trailing slash from the web app URL', () => {
    expect(normalizeWebAppUrl('https://dev.intexuraos.cloud/')).toBe('https://dev.intexuraos.cloud');
  });

  it('uses INTEXURAOS_WEB_APP_URL when resolving the configured base URL', () => {
    process.env['INTEXURAOS_WEB_APP_URL'] = 'https://dev.intexuraos.cloud';
    expect(resolveConfiguredWebAppUrl()).toBe('https://dev.intexuraos.cloud');
  });

  it('falls back to production when INTEXURAOS_WEB_APP_URL is absent', () => {
    delete process.env['INTEXURAOS_WEB_APP_URL'];
    expect(resolveConfiguredWebAppUrl()).toBe('https://intexuraos.cloud');
  });

  it('falls back to production when INTEXURAOS_WEB_APP_URL is empty', () => {
    process.env['INTEXURAOS_WEB_APP_URL'] = '';
    expect(resolveConfiguredWebAppUrl()).toBe('https://intexuraos.cloud');
  });

  it('builds code task URLs from an explicit base URL', () => {
    expect(buildCodeTaskUrl('task-1', 'https://dev.intexuraos.cloud/')).toBe(
      'https://dev.intexuraos.cloud/#/code-tasks/task-1'
    );
  });

  it('falls back to production when the explicit base URL is empty', () => {
    expect(buildCodeTaskUrl('task-1', '')).toBe('https://intexuraos.cloud/#/code-tasks/task-1');
  });
});
