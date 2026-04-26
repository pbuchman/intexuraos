/**
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { IntegrationsSection } from '../IntegrationsSection.js';

afterEach(() => {
  cleanup();
});

describe('IntegrationsSection', () => {
  it('renders integration cards', () => {
    render(<IntegrationsSection />);
    expect(screen.getByText('Connected Services')).toBeTruthy();
    expect(screen.getByText('WhatsApp')).toBeTruthy();
    expect(screen.getByText('Google Calendar')).toBeTruthy();
  });
});
