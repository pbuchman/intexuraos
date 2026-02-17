/**
 * Vitest setup file for DOM testing.
 * Imports jest-dom matchers and mocks browser APIs.
 */

import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// Mock scrollIntoView for jsdom (not implemented by default)
Element.prototype.scrollIntoView = vi.fn();
