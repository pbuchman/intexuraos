/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DigestRow } from '../DigestRow.js';

const baseSummary = {
  date: '2026-04-17',
  groupKey: 'grupa-wedkarska-skool',
  messageCount: 412,
  headline: 'Wyciek przepisów i debata o echosondach.',
  bullets: ['a', 'b', 'c'],
  threads: [],
  moderatorPosts: [],
  openQuestions: [],
  activityOutliers: [],
};

describe('DigestRow', () => {
  it('shows headline when present', () => {
    render(
      <MemoryRouter>
        <DigestRow digest={{ summary: baseSummary, generation: 1, generatedAt: '', modelId: '' }} />
      </MemoryRouter>
    );
    expect(screen.getByText(/Wyciek przepisów/)).toBeInTheDocument();
  });

  it('renders "no messages" copy when headline is empty', () => {
    const empty = { ...baseSummary, headline: '', bullets: [] };
    render(
      <MemoryRouter>
        <DigestRow digest={{ summary: empty, generation: 1, generatedAt: '', modelId: '' }} />
      </MemoryRouter>
    );
    expect(screen.getByText(/Brak wiadomości tego dnia/)).toBeInTheDocument();
  });
});
