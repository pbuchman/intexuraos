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
        headline="Recipe leak and fish-finder debate."
        bullets={['Michał: leak to Przasnysz.', 'Fish finders: Garmin vs Deeper.', 'Henryk (76 y/o) Skool onboarding.']}
      />
    );
    expect(screen.getByText(/Recipe leak/)).toBeInTheDocument();
    expect(screen.getByText(/Michał: leak/)).toBeInTheDocument();
    expect(screen.getByText(/Garmin vs Deeper/)).toBeInTheDocument();
    expect(screen.getByText(/Henryk \(76 y\/o\) Skool onboarding/)).toBeInTheDocument();
  });

  it('returns null when headline is empty and bullets are empty', () => {
    const { container } = render(<DigestHighlight headline="" bullets={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
