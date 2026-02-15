import { useState, useEffect, useCallback, useRef } from 'react';

export interface PubSubEvent {
  topic: string;
  messageId: string;
  publishTime: string;
  data: Record<string, unknown>;
  attributes: Record<string, string>;
  receivedAt: string;
}

interface SSEMessage {
  type: 'connected' | 'event';
  topics?: string[];
  event?: PubSubEvent;
}

const MAX_EVENTS = 100;
const RECONNECT_DELAYS = [1000, 2000, 5000, 10000];

// Return PubSub UI URL in dev environments (local and dev machine both run pubsub-ui on localhost)
function getPubSubUrl(): string | null {
  if (import.meta.env.DEV) return 'http://localhost:8105';
  return null;
}

export function usePubSubEvents(enabled: boolean): {
  events: PubSubEvent[];
  isConnected: boolean;
  clearEvents: () => void;
  topics: string[];
} {
  const [events, setEvents] = useState<PubSubEvent[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [topics, setTopics] = useState<string[]>([]);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearEvents = useCallback(() => {
    setEvents([]);
  }, []);

  const pubsubUrl = getPubSubUrl();

  useEffect(() => {
    if (!enabled || !pubsubUrl) {
      if (eventSourceRef.current !== null) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimeoutRef.current !== null) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      setIsConnected(false);
      return;
    }

    function connect(): void {
      if (eventSourceRef.current !== null) {
        eventSourceRef.current.close();
      }

      const eventSource = new EventSource(`${String(pubsubUrl)}/events`);
      eventSourceRef.current = eventSource;

      eventSource.onopen = (): void => {
        setIsConnected(true);
        reconnectAttemptRef.current = 0;
      };

      eventSource.onerror = (): void => {
        setIsConnected(false);
        eventSource.close();
        eventSourceRef.current = null;

        const delay = RECONNECT_DELAYS[Math.min(reconnectAttemptRef.current, RECONNECT_DELAYS.length - 1)];
        if (delay !== undefined) {
          reconnectAttemptRef.current++;
          reconnectTimeoutRef.current = setTimeout(connect, delay);
        }
      };

      eventSource.onmessage = (e: MessageEvent<string>): void => {
        try {
          const message = JSON.parse(e.data) as SSEMessage;

          if (message.type === 'connected' && message.topics !== undefined) {
            setTopics(message.topics);
          } else if (message.type === 'event' && message.event !== undefined) {
            setEvents((prev) => [message.event as PubSubEvent, ...prev.slice(0, MAX_EVENTS - 1)]);
          }
        } catch {
          // Ignore malformed messages
        }
      };
    }

    connect();

    return (): void => {
      if (eventSourceRef.current !== null) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimeoutRef.current !== null) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };
  }, [enabled, pubsubUrl]);

  return { events, isConnected, clearEvents, topics };
}
