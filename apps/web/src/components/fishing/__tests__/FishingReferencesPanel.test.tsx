/**
 * @vitest-environment jsdom
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { FishingReferencesPanel } from '../FishingReferencesPanel.js';

describe('FishingReferencesPanel', () => {
  it('renders source labels and links for assistant citations', () => {
    render(
      <MemoryRouter>
        <FishingReferencesPanel
          citations={[
            {
              sourceId: 'chunk-1',
              sourceType: 'knowledge_page',
              title: 'Spring Bait',
              quote: 'Use pinka with light groundbait.',
              usedFor: 'Groundbait recommendation',
              url: '/fishing-assistant/knowledge/pages/page-1',
              pageId: 'page-1',
            },
            {
              sourceId: 'digest-1',
              sourceType: 'digest',
              title: 'May 1 digest',
              quote: 'Members reported success on shallow water.',
              usedFor: 'Recent conditions',
              url: '/fishing-assistant/digests/feeder/2026-05-01',
              date: '2026-05-01',
            },
            {
              sourceId: 'raw-1',
              sourceType: 'raw_message',
              title: 'Raw WhatsApp message',
              quote: 'Wind pushed fish into the margin.',
              usedFor: 'Eyewitness detail',
            },
          ]}
        />
      </MemoryRouter>
    );

    expect(screen.getByText('Knowledge Base')).toBeInTheDocument();
    expect(screen.getByText('Digest')).toBeInTheDocument();
    expect(screen.getByText('Raw message')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /spring bait/i })).toHaveAttribute(
      'href',
      '/fishing-assistant/knowledge/pages/page-1'
    );
    expect(screen.getByRole('link', { name: /may 1 digest/i })).toHaveAttribute(
      'href',
      '/fishing-assistant/digests/feeder/2026-05-01'
    );
    expect(screen.getByText(/wind pushed fish into the margin/i)).toBeInTheDocument();
  });
});
