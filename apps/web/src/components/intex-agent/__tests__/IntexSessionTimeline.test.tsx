import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { IntexAgentSession, IntexAgentSessionEvent, IntexAgentToolName } from '@/types';
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

function event(overrides: Partial<IntexAgentSessionEvent> = {}): IntexAgentSessionEvent {
  return {
    id: 'event-1',
    sessionId: 'session-1',
    userId: 'user-1',
    type: 'user_message',
    payload: { text: 'Visible user text' },
    createdAt: '2026-06-24T22:15:01.000Z',
    ...overrides,
  };
}

function getEventCard(title: string): HTMLElement {
  const card = screen.getByText(title).closest('article');
  if (!(card instanceof HTMLElement)) {
    throw new Error('Expected event card');
  }
  return card;
}

interface EventBodyCase {
  payload: Record<string, unknown>;
  body: string;
  omitted: string[];
}

const EVENT_BODY_CASES = {
  session_started: {
    payload: {
      reason: 'no_active_session',
      status: 'active',
      explicit: true,
      text: 'Ignored lifecycle text',
    },
    body: 'Reason: No Active Session · Explicitly announced to user',
    omitted: ['Ignored lifecycle text'],
  },
  session_closed: {
    payload: {
      reason: 'tool_completed',
      status: 'completed',
      message: 'Ignored closed-session message',
    },
    body: 'Reason: Tool Completed · Status: Completed',
    omitted: ['Ignored closed-session message'],
  },
  user_message: {
    payload: { text: 'Visible matrix user text', message: 'Ignored user message' },
    body: 'Visible matrix user text',
    omitted: ['Ignored user message'],
  },
  assistant_message: {
    payload: { text: 'Visible matrix assistant text', message: 'Ignored assistant message' },
    body: 'Visible matrix assistant text',
    omitted: ['Ignored assistant message'],
  },
  agent_fallback: {
    payload: {
      reason: 'runner_output_malformed',
      status: 'waiting_for_user',
      text: 'Ignored fallback text',
    },
    body: 'Reason: Runner Output Malformed',
    omitted: ['Ignored fallback text'],
  },
  clarification_requested: {
    payload: { message: 'Visible clarification', text: 'Ignored clarification fallback' },
    body: 'Visible clarification',
    omitted: ['Ignored clarification fallback'],
  },
  confirmation_requested: {
    payload: {
      message: '{"nestedTransport":"hidden"}',
      text: 'Visible confirmation fallback',
    },
    body: 'Visible confirmation fallback',
    omitted: ['{"nestedTransport":"hidden"}'],
  },
  confirmation_resolved: {
    payload: { resolution: 'accepted', text: 'Ignored resolution text' },
    body: 'Resolution: Accepted',
    omitted: ['Ignored resolution text'],
  },
  tool_call_started: {
    payload: { toolName: 'create_note', text: 'Ignored started-tool text' },
    body: 'Tool: Create Note',
    omitted: ['Ignored started-tool text'],
  },
  tool_call_completed: {
    payload: { toolName: 'create_calendar_event', text: 'Ignored completed-tool text' },
    body: 'Tool: Create Calendar Event',
    omitted: ['Ignored completed-tool text'],
  },
  tool_call_failed: {
    payload: { toolName: 'save_external', message: 'Ignored failed-tool message' },
    body: 'Tool: Save External',
    omitted: ['Ignored failed-tool message'],
  },
  unsupported_request: {
    payload: { message: 'Visible unsupported message', text: 'Ignored unsupported fallback' },
    body: 'Visible unsupported message',
    omitted: ['Ignored unsupported fallback'],
  },
} satisfies Record<IntexAgentSessionEvent['type'], EventBodyCase>;

const EVENT_BODY_TYPES = Object.keys(EVENT_BODY_CASES) as IntexAgentSessionEvent['type'][];

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

  it('keeps ordinary user and assistant text visible', () => {
    render(
      <IntexSessionTimeline
        session={session()}
        events={[
          event(),
          event({
            id: 'event-2',
            type: 'assistant_message',
            payload: { text: 'Visible assistant text' },
          }),
        ]}
        loading={false}
      />
    );

    expect(screen.getByText('Visible user text')).toBeInTheDocument();
    expect(screen.getByText('Visible assistant text')).toBeInTheDocument();
  });

  it.each(EVENT_BODY_TYPES)('renders only the allow-listed body for %s', (type) => {
    const bodyCase = EVENT_BODY_CASES[type];
    render(
      <IntexSessionTimeline
        session={session()}
        events={[
          event({
            type,
            payload: { ...bodyCase.payload, privateMetadata: 'Ignored technical marker' },
          }),
        ]}
        loading={false}
      />
    );

    expect(screen.getByText(bodyCase.body)).toBeInTheDocument();
    expect(screen.queryByText('Ignored technical marker')).not.toBeInTheDocument();
    for (const omitted of bodyCase.omitted) {
      expect(screen.queryByText(omitted)).not.toBeInTheDocument();
    }
  });

  it('omits serialized object and array message strings', () => {
    render(
      <IntexSessionTimeline
        session={session()}
        events={[
          event({ payload: { text: '{"transportId":"hidden"}' } }),
          event({
            id: 'event-2',
            type: 'assistant_message',
            payload: { text: '[{"metadataToken":"hidden"}]' },
          }),
        ]}
        loading={false}
      />
    );

    expect(screen.queryByText(/transportId/)).not.toBeInTheDocument();
    expect(screen.queryByText(/metadataToken/)).not.toBeInTheDocument();
    expect(getEventCard('User').querySelector('p')).toBeNull();
    expect(getEventCard('IntexuraOS').querySelector('p')).toBeNull();
  });

  it.each([
    ['accepted', 'Accepted'],
    ['rejected', 'Rejected'],
    ['superseded', 'Superseded'],
  ])('renders only the normalized %s confirmation resolution', (resolution, label) => {
    render(
      <IntexSessionTimeline
        session={session()}
        events={[
          event({
            type: 'confirmation_resolved',
            payload: {
              resolution,
              requestId: 'hidden',
              metadata: { source: 'transport' },
            },
          }),
        ]}
        loading={false}
      />
    );

    expect(screen.getByText(`Resolution: ${label}`)).toBeInTheDocument();
    expect(screen.queryByText(/requestId|metadata|transport/)).not.toBeInTheDocument();
  });

  it('keeps a confirmation card with an unknown resolution but omits its body', () => {
    const confirmation = event({
      type: 'confirmation_resolved',
      payload: { resolution: 'confirmed', requestId: 'hidden' },
      createdAt: '2026-06-25T09:30:00.000Z',
    });

    render(
      <IntexSessionTimeline
        session={session()}
        events={[confirmation]}
        loading={false}
      />
    );

    const card = getEventCard('Confirmation resolved');
    expect(card).toHaveTextContent(formatDateTimeCompact(confirmation.createdAt));
    expect(card.querySelector('p')).toBeNull();
  });

  it.each([
    ['session_started', { reason: 'tool_completed' }, 'Session started'],
    ['session_closed', { reason: 'no_active_session' }, 'Session closed'],
    ['session_closed', { status: 'future_status' }, 'Session closed'],
    ['agent_fallback', { reason: 'future_fallback' }, 'Agent fallback'],
  ] satisfies [IntexAgentSessionEvent['type'], Record<string, unknown>, string][]) (
    'omits an unknown canonical value for %s',
    (type, payload, title) => {
      render(
        <IntexSessionTimeline
          session={session()}
          events={[event({ type, payload })]}
          loading={false}
        />
      );

      expect(getEventCard(title).querySelector('p')).toBeNull();
    }
  );

  it.each([
    ['session_started', 'Session started'],
    ['agent_fallback', 'Agent fallback'],
  ] satisfies [IntexAgentSessionEvent['type'], string][]) (
    'omits status when it is not allow-listed for %s',
    (type, title) => {
      render(
        <IntexSessionTimeline
          session={session()}
          events={[event({ type, payload: { status: 'active' } })]}
          loading={false}
        />
      );

      expect(getEventCard(title).querySelector('p')).toBeNull();
    }
  );

  it.each([
    ['tool_call_started', 'Tool call started'],
    ['tool_call_completed', 'Tool call completed'],
    ['tool_call_failed', 'Tool call failed'],
  ] satisfies [IntexAgentSessionEvent['type'], string][]) (
    'uses a safe title and no body for an unknown %s tool name',
    (type, title) => {
      render(
        <IntexSessionTimeline
          session={session()}
          events={[event({ type, payload: { toolName: 'future_tool' } })]}
          loading={false}
        />
      );

      expect(getEventCard(title).querySelector('p')).toBeNull();
      expect(screen.queryByText(/Future Tool/)).not.toBeInTheDocument();
    }
  );

  it.each(['null', 'true', '42', '"visible-json-string"']) (
    'keeps the JSON primitive %s as ordinary message text',
    (text) => {
      render(
        <IntexSessionTimeline
          session={session()}
          events={[event({ payload: { text } })]}
          loading={false}
        />
      );

      expect(screen.getByText(text)).toBeInTheDocument();
    }
  );

  it('keeps syntactically invalid JSON-like text visible', () => {
    const text = '{not actually json';

    render(
      <IntexSessionTimeline
        session={session()}
        events={[event({ payload: { text } })]}
        loading={false}
      />
    );

    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it.each([
    ['tool_call_started', 'create_note', 'Create Note started'],
    ['tool_call_completed', 'create_calendar_event', 'Create Calendar Event completed'],
    ['tool_call_failed', 'save_external', 'Save External failed'],
  ] satisfies [IntexAgentSessionEvent['type'], IntexAgentToolName, string][]) (
    'renders the canonical title for %s with %s',
    (type, toolName, title) => {
      render(
        <IntexSessionTimeline
          session={session()}
          events={[event({ type, payload: { toolName } })]}
          loading={false}
        />
      );

      expect(screen.getByText(title)).toBeInTheDocument();
    }
  );

  it('renders only the normalized tool name for tool completion', () => {
    render(
      <IntexSessionTimeline
        session={session()}
        events={[
          event({
            type: 'tool_call_completed',
            payload: {
              toolName: 'create_note',
              result: { reference: 'hidden' },
              metadata: { transportId: 'hidden' },
            },
          }),
        ]}
        loading={false}
      />
    );

    expect(screen.getByText('Tool: Create Note')).toBeInTheDocument();
    expect(screen.queryByText(/result|reference|metadata|transportId/)).not.toBeInTheDocument();
  });

  it('keeps unsupported technical payload data out of the rendered card', () => {
    const unsupported = event({
      type: 'unsupported_request',
      payload: {
        transportId: 'hidden',
        metadata: { requestId: 'hidden' },
      },
      createdAt: '2026-06-25T10:00:00.000Z',
    });

    render(
      <IntexSessionTimeline session={session()} events={[unsupported]} loading={false} />
    );

    const card = getEventCard('Unsupported request');
    expect(card).toHaveTextContent(formatDateTimeCompact(unsupported.createdAt));
    expect(card.querySelector('p')).toBeNull();
    expect(screen.queryByText(/transportId|metadata|requestId/)).not.toBeInTheDocument();
  });
});
