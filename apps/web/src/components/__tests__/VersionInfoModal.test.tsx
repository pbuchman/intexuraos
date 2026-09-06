/**
 * Tests for VersionInfoModal component.
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { VersionInfoModal } from '../VersionInfoModal.js';

const buildEnv = import.meta.env as Record<string, string | undefined>;
const originalEnv = { ...import.meta.env };

describe('VersionInfoModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    Object.assign(import.meta.env, originalEnv);
    cleanup();
  });

  it('falls back when build metadata is missing or invalid', () => {
    delete buildEnv['INTEXURAOS_BUILD_VERSION'];
    delete buildEnv['INTEXURAOS_COMMIT_SHA'];
    buildEnv['INTEXURAOS_COMMIT_MESSAGE'] = '';
    buildEnv['INTEXURAOS_BUILD_DATE'] = 'not-a-date';

    render(<VersionInfoModal onClose={vi.fn()} />);

    expect(screen.getByText('Unknown version')).toBeInTheDocument();
    expect(screen.getByText('Unknown commit')).toBeInTheDocument();
    expect(screen.getByText('unknown')).toBeInTheDocument();
    expect(screen.getByText('Unknown build date')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^unknown$/i })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog')).toHaveClass('z-[60]');
    expect(document.querySelector('.z-\\[55\\]')).toBeInTheDocument();
  });
});
