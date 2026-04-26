/**
 * Vitest setup file for DOM testing.
 * Imports jest-dom matchers and mocks browser APIs.
 */

import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// Ensure React development build is loaded so React.act is available
// (react-dom/test-utils delegates to React.act which only exists in dev/test builds)
process.env['NODE_ENV'] = 'test';

// Mock scrollIntoView/scrollTo for jsdom (not implemented by default).
// Guarded so tests using `@vitest-environment node` (where Element is undefined)
// don't crash during setup.
if (typeof Element !== 'undefined') {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.scrollTo = vi.fn();
}
