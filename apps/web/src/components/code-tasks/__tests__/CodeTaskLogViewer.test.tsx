/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { CodeTaskLogViewer } from '../CodeTaskLogViewer.js';
import type { LogLine } from '@/hooks/useCodeTaskLogs.js';

function makeLine(text: string, sequence = 0): LogLine {
  return { sequence, text };
}

// Suppress scrollTo in jsdom
beforeAll(() => {
  Element.prototype.scrollTo = vi.fn() as unknown as typeof Element.prototype.scrollTo;
});

afterEach(() => {
  cleanup();
});

describe('CodeTaskLogViewer link rendering', () => {
  const baseProps = {
    logs: [] as LogLine[],
    isActive: false,
    listenerHealthy: true,
    taskStatus: 'implemented' as const,
  };

  it('renders a single URL as a clickable link', () => {
    const logs = [makeLine('[claude] See https://github.com/org/repo')];
    render(<CodeTaskLogViewer {...baseProps} logs={logs} />);

    const link = screen.getByRole('link', { name: /github\.com/ });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', 'https://github.com/org/repo');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('renders multiple URLs in a single log line', () => {
    const logs = [makeLine('Links: https://a.com and https://b.com end')];
    render(<CodeTaskLogViewer {...baseProps} logs={logs} />);

    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute('href', 'https://a.com');
    expect(links[1]).toHaveAttribute('href', 'https://b.com');
  });

  it('renders plain text without links when no URL present', () => {
    const logs = [makeLine('[claude] No links here')];
    render(<CodeTaskLogViewer {...baseProps} logs={logs} />);

    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText(/No links here/)).toBeInTheDocument();
  });

  it('truncates long URLs in display text but keeps full URL in href', () => {
    const longPath = 'a'.repeat(100);
    const fullUrl = `https://example.com/${longPath}`;
    const logs = [makeLine(`Check ${fullUrl}`)];
    render(<CodeTaskLogViewer {...baseProps} logs={logs} />);

    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', fullUrl);
    // Display text should be truncated (contains ellipsis)
    expect(link.textContent?.length).toBeLessThan(fullUrl.length);
  });

  it('applies correct CSS classes to links', () => {
    const logs = [makeLine('[tool] Output at https://example.com')];
    render(<CodeTaskLogViewer {...baseProps} logs={logs} />);

    const link = screen.getByRole('link');
    expect(link.className).toContain('text-blue-600');
    expect(link.className).toContain('underline');
  });
});
