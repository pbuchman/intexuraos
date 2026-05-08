/**
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { FishingReferencesPanel } from '../FishingReferencesPanel.js';

describe('FishingReferencesPanel', () => {
  afterEach(() => {
    cleanup();
  });

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

    fireEvent.click(screen.getByRole('button', { name: /knowledge base spring bait/i }));
    fireEvent.click(screen.getByRole('button', { name: /digest may 1 digest/i }));
    fireEvent.click(screen.getByRole('button', { name: /raw message raw whatsapp message/i }));

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

  it('renders every reference collapsed by default and expands only the selected reference', () => {
    render(
      <MemoryRouter>
        <FishingReferencesPanel
          selectionKey="message-1"
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
          ]}
        />
      </MemoryRouter>
    );

    const springButton = screen.getByRole('button', { name: /knowledge base spring bait/i });
    const digestButton = screen.getByRole('button', { name: /digest may 1 digest/i });

    expect(springButton).toHaveAttribute('aria-expanded', 'false');
    expect(digestButton).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(/use pinka with light groundbait/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/members reported success/i)).not.toBeInTheDocument();

    fireEvent.click(springButton);

    expect(springButton).toHaveAttribute('aria-expanded', 'true');
    expect(digestButton).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText(/use pinka with light groundbait/i)).toBeInTheDocument();
    expect(screen.queryByText(/members reported success/i)).not.toBeInTheDocument();
  });

  it('collapses expanded references when the selected assistant message changes', () => {
    const citations = [
      {
        sourceId: 'chunk-1',
        sourceType: 'knowledge_page' as const,
        title: 'Spring Bait',
        quote: 'Use pinka with light groundbait.',
        usedFor: 'Groundbait recommendation',
        url: '/fishing-assistant/knowledge/pages/page-1',
        pageId: 'page-1',
      },
    ];

    const { rerender } = render(
      <MemoryRouter>
        <FishingReferencesPanel selectionKey="message-1" citations={citations} />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: /knowledge base spring bait/i }));
    expect(screen.getByText(/use pinka with light groundbait/i)).toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <FishingReferencesPanel selectionKey="message-2" citations={citations} />
      </MemoryRouter>
    );

    expect(screen.getByRole('button', { name: /knowledge base spring bait/i })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
    expect(screen.queryByText(/use pinka with light groundbait/i)).not.toBeInTheDocument();
  });

  it('keeps expanded reference detail text wrapped inside the panel', () => {
    render(
      <MemoryRouter>
        <FishingReferencesPanel
          citations={[
            {
              sourceId: 'chunk-1',
              sourceType: 'knowledge_page',
              title: 'VeryLongKnowledgePageTitleThatShouldWrapInsideTheReferencePanel',
              quote: 'VeryLongQuoteTextThatShouldWrapInsideTheExpandedReferencePanel',
              usedFor: 'VeryLongUsageReasonThatShouldWrapInsideTheReferencePanel',
              url: '/fishing-assistant/knowledge/pages/page-1',
              pageId: 'page-1',
            },
          ]}
        />
      </MemoryRouter>
    );

    fireEvent.click(
      screen.getByRole('button', {
        name: /knowledge base verylongknowledgepagetitlethatshouldwrap/i,
      })
    );

    expect(
      screen.getByRole('link', {
        name: /verylongknowledgepagetitlethatshouldwrapinsidethereferencepanel/i,
      })
    ).toHaveClass('min-w-0', 'break-words');
    expect(screen.getByText(/verylongusagereasonthatshouldwrap/i)).toHaveClass('break-words');
    expect(screen.getByText(/verylongquotetextthatshouldwrap/i)).toHaveClass('break-words');
  });
});
