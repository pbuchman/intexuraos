import { useState } from 'react';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Clock,
  ExternalLink,
  MapPin,
  RefreshCw,
  Users,
  AlertCircle,
  X,
} from 'lucide-react';
import { Button, Card, Layout } from '@/components';
import { useCalendarEvents, useFailedCalendarEvents } from '@/hooks';
import type { CalendarEvent, CalendarEventDateTime, FailedCalendarEvent } from '@/types';

function formatTimeOnly(dt: CalendarEventDateTime): string {
  if (dt.dateTime !== undefined) {
    return new Date(dt.dateTime).toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  return 'All day';
}

function isAllDayEvent(event: CalendarEvent): boolean {
  return event.start.date !== undefined;
}

function getEventDate(event: CalendarEvent): Date {
  if (event.start.dateTime !== undefined) {
    return new Date(event.start.dateTime);
  }
  if (event.start.date !== undefined) {
    return new Date(event.start.date);
  }
  return new Date();
}

function formatWeekRange(start: Date, end: Date): string {
  const startStr = start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const endStr = end.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  return `${startStr} - ${endStr}`;
}

function groupEventsByDate(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
  const grouped = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    const date = getEventDate(event);
    const dateKey = date.toDateString();
    const existing = grouped.get(dateKey);
    if (existing !== undefined) {
      existing.push(event);
    } else {
      grouped.set(dateKey, [event]);
    }
  }
  return grouped;
}

interface EventRowProps {
  event: CalendarEvent;
}

function EventRow({ event }: EventRowProps): React.JSX.Element {
  const allDay = isAllDayEvent(event);

  return (
    <div className="flex gap-4 rounded-lg border border-slate-200 bg-white p-4 transition-colors hover:bg-slate-50">
      <div className="flex w-20 shrink-0 flex-col items-center justify-center rounded-lg bg-blue-50 p-2 text-center">
        <Clock className="mb-1 h-4 w-4 text-blue-600" />
        <span className="text-xs font-medium text-blue-700">
          {allDay ? 'All day' : formatTimeOnly(event.start)}
        </span>
        {!allDay && (
          <span className="text-xs text-blue-500">
            {formatTimeOnly(event.end)}
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-medium text-slate-900">{event.summary}</h3>
          {event.htmlLink !== undefined && (
            <a
              href={event.htmlLink}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-blue-600"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          )}
        </div>

        {event.description !== undefined && event.description !== '' && (
          <p className="mt-1 line-clamp-2 text-sm text-slate-500">{event.description}</p>
        )}

        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-500">
          {event.location !== undefined && event.location !== '' && (
            <span className="flex items-center gap-1">
              <MapPin className="h-3 w-3" />
              {event.location}
            </span>
          )}
          {event.attendees !== undefined && event.attendees.length > 0 && (
            <span className="flex items-center gap-1">
              <Users className="h-3 w-3" />
              {event.attendees.length} attendee{event.attendees.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

interface FailedEventCardProps {
  event: FailedCalendarEvent;
  onDismiss: (id: string) => void;
}

function FailedEventCard({ event, onDismiss }: FailedEventCardProps): React.JSX.Element {
  return (
    <div className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
      <div className="flex shrink-0 items-center justify-center rounded-lg bg-amber-100 p-2 text-amber-600">
        <AlertCircle className="h-4 w-4" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-start justify-between gap-2">
          <h4 className="font-medium text-amber-900">
            {event.summary ?? 'Untitled event'}
          </h4>
          <button
            type="button"
            onClick={() => {
              onDismiss(event.id);
            }}
            className="shrink-0 rounded p-1 text-amber-400 transition-colors hover:bg-amber-100 hover:text-amber-600"
            aria-label="Dismiss"
          >
            <X className="h-3 w-3" />
          </button>
        </div>

        {event.description !== null && event.description !== '' && (
          <p className="mb-2 line-clamp-2 text-sm text-amber-700">{event.description}</p>
        )}

        <div className="mb-2 rounded-md bg-amber-100 px-2 py-1 text-xs text-amber-800">
          <span className="font-medium">Issue:</span> {event.error}
        </div>

        <div className="text-xs text-amber-600">
          <span className="font-medium">Original text:</span> "{event.originalText}"
        </div>

        {event.reasoning !== null && (
          <div className="mt-1 text-xs text-amber-600">
            <span className="font-medium">Reasoning:</span> {event.reasoning}
          </div>
        )}
      </div>
    </div>
  );
}

interface NeedsAttentionSectionProps {
  events: FailedCalendarEvent[];
  onDismiss: (id: string) => void;
}

function NeedsAttentionSection({
  events,
  onDismiss,
}: NeedsAttentionSectionProps): React.JSX.Element | null {
  const [expanded, setExpanded] = useState(false);
  const visibleCount = expanded ? events.length : Math.min(events.length, 3);

  if (events.length === 0) {
    return null;
  }

  return (
    <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-5 w-5 text-amber-600" />
          <h3 className="font-semibold text-amber-900">
            Needs Attention ({events.length})
          </h3>
        </div>
        {events.length > 3 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setExpanded(!expanded);
            }}
            className="text-amber-700 hover:bg-amber-100 hover:text-amber-900"
          >
            {expanded ? (
              <>
                <span>Show less</span>
                <ChevronUp className="ml-1 h-4 w-4" />
              </>
            ) : (
              <>
                <span>Show all ({events.length})</span>
                <ChevronDown className="ml-1 h-4 w-4" />
              </>
            )}
          </Button>
        )}
      </div>

      <p className="mb-4 text-sm text-amber-700">
        These events couldn't be created. Please edit them and try again.
      </p>

      <div className="space-y-2">
        {events.slice(0, visibleCount).map((event) => (
          <FailedEventCard key={event.id} event={event} onDismiss={onDismiss} />
        ))}
      </div>
    </div>
  );
}

interface DateGroupProps {
  date: string;
  events: CalendarEvent[];
}

function DateGroup({ date, events }: DateGroupProps): React.JSX.Element {
  const dateObj = new Date(date);
  const isToday = new Date().toDateString() === date;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h3 className={`text-sm font-semibold ${isToday ? 'text-blue-600' : 'text-slate-700'}`}>
          {dateObj.toLocaleDateString(undefined, {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
          })}
        </h3>
        {isToday && (
          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
            Today
          </span>
        )}
      </div>
      <div className="space-y-2">
        {events.map((event) => (
          <EventRow key={event.id} event={event} />
        ))}
      </div>
    </div>
  );
}

export function CalendarPage(): React.JSX.Element {
  const { events, loading, error, filters, setFilters, refresh } = useCalendarEvents();
  const {
    events: failedEvents,
    loading: failedEventsLoading,
    refresh: refreshFailedEvents,
  } = useFailedCalendarEvents();
  const [refreshing, setRefreshing] = useState(false);
  const [dismissedFailedEventIds, setDismissedFailedEventIds] = useState<Set<string>>(new Set());

  const currentStart = filters.timeMin !== undefined ? new Date(filters.timeMin) : new Date();
  const currentEnd = filters.timeMax !== undefined ? new Date(filters.timeMax) : new Date();

  const handlePrevWeek = (): void => {
    const newStart = new Date(currentStart);
    newStart.setDate(newStart.getDate() - 7);
    const newEnd = new Date(newStart);
    newEnd.setDate(newStart.getDate() + 7);

    setFilters({
      ...filters,
      timeMin: newStart.toISOString(),
      timeMax: newEnd.toISOString(),
    });
  };

  const handleNextWeek = (): void => {
    const newStart = new Date(currentStart);
    newStart.setDate(newStart.getDate() + 7);
    const newEnd = new Date(newStart);
    newEnd.setDate(newStart.getDate() + 7);

    setFilters({
      ...filters,
      timeMin: newStart.toISOString(),
      timeMax: newEnd.toISOString(),
    });
  };

  const handleToday = (): void => {
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);

    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 7);

    setFilters({
      ...filters,
      timeMin: startOfWeek.toISOString(),
      timeMax: endOfWeek.toISOString(),
    });
  };

  const handleRefresh = async (): Promise<void> => {
    setRefreshing(true);
    try {
      await Promise.all([refresh(), refreshFailedEvents()]);
    } finally {
      setRefreshing(false);
    }
  };

  const handleDismissFailedEvent = (id: string): void => {
    setDismissedFailedEventIds((prev) => new Set([...prev, id]));
  };

  const visibleFailedEvents = failedEvents.filter(
    (event) => !dismissedFailedEventIds.has(event.id)
  );

  const groupedEvents = groupEventsByDate(events);
  const sortedDates = Array.from(groupedEvents.keys()).sort(
    (a, b) => new Date(a).getTime() - new Date(b).getTime()
  );

  if (loading && failedEventsLoading && events.length === 0) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Calendar</h2>
          <p className="text-slate-600">Events from your connected Google Calendar.</p>
        </div>
        <Button
          type="button"
          variant="secondary"
          onClick={(): void => {
            void handleRefresh();
          }}
          disabled={refreshing}
          isLoading={refreshing}
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      <NeedsAttentionSection
        events={visibleFailedEvents}
        onDismiss={handleDismissFailedEvent}
      />

      <div className="mb-6 flex items-center justify-between rounded-lg border border-slate-200 bg-white p-4">
        <Button type="button" variant="ghost" size="sm" onClick={handlePrevWeek}>
          <ChevronLeft className="h-4 w-4" />
        </Button>

        <div className="flex items-center gap-3">
          <CalendarIcon className="h-5 w-5 text-slate-500" />
          <span className="font-medium text-slate-700">
            {formatWeekRange(currentStart, currentEnd)}
          </span>
          <Button type="button" variant="secondary" size="sm" onClick={handleToday}>
            Today
          </Button>
        </div>

        <Button type="button" variant="ghost" size="sm" onClick={handleNextWeek}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {error !== null && error !== '' && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
          {error}
        </div>
      )}

      {events.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <CalendarIcon className="mb-4 h-12 w-12 text-slate-300" />
            <h3 className="mb-2 text-lg font-medium text-slate-900">No events this week</h3>
            <p className="mb-4 text-slate-500">
              Your calendar is clear for the selected time range.
            </p>
          </div>
        </Card>
      ) : (
        <div className="space-y-6">
          {sortedDates.map((dateKey) => {
            const dateEvents = groupedEvents.get(dateKey);
            if (dateEvents === undefined) return null;
            return <DateGroup key={dateKey} date={dateKey} events={dateEvents} />;
          })}
        </div>
      )}
    </Layout>
  );
}
