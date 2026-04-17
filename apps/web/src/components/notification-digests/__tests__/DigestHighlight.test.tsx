/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DigestHighlight } from '../DigestHighlight.js';

describe('DigestHighlight', () => {
  it('renders headline and every bullet', () => {
    render(
      <DigestHighlight
        headline="Wyciek przepisów i debata o echosondach."
        bullets={['Michał: wyciek do Przasnysza.', 'Echosondy: Garmin vs Deeper.', 'Henryk (76 l.) onboarding Skool.']}
      />
    );
    expect(screen.getByText(/Wyciek przepisów/)).toBeInTheDocument();
    expect(screen.getByText(/Michał: wyciek/)).toBeInTheDocument();
    expect(screen.getByText(/Garmin vs Deeper/)).toBeInTheDocument();
    expect(screen.getByText(/Henryk \(76 l\.\) onboarding Skool/)).toBeInTheDocument();
  });

  it('returns null when headline is empty and bullets are empty', () => {
    const { container } = render(<DigestHighlight headline="" bullets={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
