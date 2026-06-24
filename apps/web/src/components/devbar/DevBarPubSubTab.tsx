import { useState, useMemo, useEffect, useRef } from 'react';
import type { PubSubEvent } from '@/hooks/usePubSubEvents';
import { FilterChip } from './FilterChip.js';
import { ConnectionStatus } from './ConnectionStatus.js';
import { ExpandableItem } from './ExpandableItem.js';
import { JsonView } from './JsonView.js';

const KNOWN_TOPICS = [
  'whatsapp-send-message',
  'research-process',
  'llm-call',
  'whatsapp-media-cleanup',
  'commands-ingest',
  'intex-message-ingest',
  'whatsapp-webhook-process',
  'whatsapp-transcription',
  'approval-reply',
  'calendar-preview',
];

interface DevBarPubSubTabProps {
  events: PubSubEvent[];
  isConnected: boolean;
  topics: string[];
  onClear: () => void;
  selectedTopics: string[];
  onTopicsChange: (topics: string[]) => void;
  follow: boolean;
  onFollowChange: (follow: boolean) => void;
}

export function DevBarPubSubTab({
  events,
  isConnected,
  topics,
  onClear,
  selectedTopics: persistedTopics,
  onTopicsChange,
  follow,
  onFollowChange,
}: DevBarPubSubTabProps): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showAllTopics, setShowAllTopics] = useState(false);

  const allTopics = useMemo(() => {
    const combined = new Set([...KNOWN_TOPICS, ...topics]);
    return Array.from(combined).sort();
  }, [topics]);

  const selectedSet = useMemo(() => {
    if (persistedTopics.length === 0) {
      return new Set(KNOWN_TOPICS);
    }
    return new Set(persistedTopics);
  }, [persistedTopics]);

  useEffect(() => {
    if (persistedTopics.length === 0) {
      onTopicsChange(KNOWN_TOPICS);
    }
  }, [persistedTopics.length, onTopicsChange]);

  const visibleTopics = showAllTopics ? allTopics : allTopics.slice(0, 5);
  const hiddenCount = allTopics.length - visibleTopics.length;

  const filteredEvents = useMemo(() => {
    return events.filter((e) => selectedSet.has(e.topic));
  }, [events, selectedSet]);

  useEffect(() => {
    if (follow && scrollRef.current !== null) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [filteredEvents, follow]);

  const toggleTopic = (topic: string): void => {
    if (selectedSet.has(topic)) {
      onTopicsChange(Array.from(selectedSet).filter((t) => t !== topic));
    } else {
      onTopicsChange([...Array.from(selectedSet), topic]);
    }
  };

  const toggleAll = (): void => {
    if (selectedSet.size === allTopics.length) {
      onTopicsChange([]);
    } else {
      onTopicsChange(allTopics);
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-700 pb-2 mb-2">
        <span className="text-xs text-slate-500">Topics:</span>
        <FilterChip
          label={selectedSet.size === allTopics.length ? 'All ✓' : 'All'}
          isActive={selectedSet.size === allTopics.length}
          onClick={toggleAll}
        />
        {visibleTopics.map((topic) => (
          <FilterChip
            key={topic}
            label={topic.replace('whatsapp-', 'wa-')}
            isActive={selectedSet.has(topic)}
            onClick={() => {
              toggleTopic(topic);
            }}
          />
        ))}
        {hiddenCount > 0 && (
          <button
            onClick={() => {
              setShowAllTopics(true);
            }}
            className="text-xs text-amber-500 hover:text-amber-400"
          >
            +{hiddenCount} more
          </button>
        )}
        <div className="ml-auto flex items-center gap-3">
          <button
            onClick={() => {
              onFollowChange(!follow);
            }}
            className={`flex items-center gap-1 text-xs transition-colors ${
              follow ? 'text-emerald-400' : 'text-slate-500 hover:text-slate-300'
            }`}
            title={follow ? 'Auto-scroll enabled' : 'Auto-scroll disabled'}
          >
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            </svg>
            Follow
          </button>
          <ConnectionStatus isConnected={isConnected} label={isConnected ? 'Live' : 'Disconnected'} />
          <button
            onClick={onClear}
            className="text-xs text-slate-500 hover:text-slate-300"
            title="Clear events"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Event List */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-0.5">
        {filteredEvents.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-slate-500">
            <div className="text-center">
              <svg
                className="mx-auto h-8 w-8 text-slate-600 mb-2"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                />
              </svg>
              <p>No Pub/Sub events yet</p>
              <p className="text-xs text-slate-600 mt-1">Events will appear here in real-time</p>
            </div>
          </div>
        ) : (
          filteredEvents.map((event) => (
            <ExpandableItem
              key={event.messageId}
              className="rounded border-l border-transparent hover:border-amber-500"
              expandedContent={<JsonView data={event.data} />}
            >
              <div className="flex flex-1 items-center gap-1.5 px-1 py-0.5 text-[11px]">
                <span className="w-14 flex-shrink-0 text-slate-500 font-mono text-[10px]">
                  {new Date(event.publishTime).toLocaleTimeString('en-GB')}
                </span>
                <span className="w-28 flex-shrink-0 truncate rounded px-1 text-amber-400 font-medium text-[10px]">
                  {event.topic.replace('whatsapp-', 'wa-')}
                </span>
                <span className="w-14 flex-shrink-0 text-slate-600 font-mono text-[9px]">
                  {event.messageId.slice(0, 8)}
                </span>
                <span className="flex-1 truncate text-slate-300">
                  {JSON.stringify(event.data).slice(0, 80)}
                </span>
              </div>
            </ExpandableItem>
          ))
        )}
      </div>
    </div>
  );
}
