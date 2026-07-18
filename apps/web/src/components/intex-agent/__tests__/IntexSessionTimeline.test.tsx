import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { IntexAgentSession } from '@/types';
import { formatDateTimeCompact } from '@/utils/dateFormat';
import { IntexSessionTimeline } from '../IntexSessionTimeline.js';

function session(overrides: Partial<IntexAgentSession> = {}): IntexAgentSession {
  return {
    id: 'session-1',
    userId: 'user-1',
    channel: 'whatsapp',
    status: 'completed',
    startedAt: '2026-06-24T22:15:00.000Z',
    endedAt: '2026-06-24T22:15:06.903Z',
    lastUserMessageAt: '2026-06-24T22:15:00.000Z',
    lastAssistantMessageAt: '2026-06-24T22:15:06.903Z',
    startReason: 'no_active_session',
    endReason: 'tool_completed',
    activeTool: 'create_research',
    summary: 'Created research draft',
    ...overrides,
  };
}

describe('IntexSessionTimeline', () => {
  afterEach(() => {
    cleanup();
  });

  it('formats assistant timestamps and renders current tool names in metadata', () => {
    render(<IntexSessionTimeline session={session()} events={[]} loading={false} />);

    expect(screen.getByText('Tool: Create Research')).toBeInTheDocument();
    expect(
      screen.getByText(`Assistant: ${formatDateTimeCompact('2026-06-24T22:15:06.903Z')}`)
    ).toBeInTheDocument();
    expect(screen.queryByText(/2026-06-24T22:15:06.903Z/)).not.toBeInTheDocument();
  });

  it('renders absent end state as open and absent active tool as none', () => {
    const openSession = session({ startedAt: 'not-a-timestamp' });
    delete openSession.endedAt;
    delete openSession.endReason;
    delete openSession.activeTool;

    render(<IntexSessionTimeline session={openSession} events={[]} loading={false} />);

    expect(screen.getByText('End: Open')).toBeInTheDocument();
    expect(screen.getByText('Tool: None')).toBeInTheDocument();
    expect(screen.getByText('Started Unknown')).toBeInTheDocument();
    expect(screen.queryByText('End: Unknown')).not.toBeInTheDocument();
    expect(screen.queryByText('Tool: Unknown')).not.toBeInTheDocument();
  });
});
