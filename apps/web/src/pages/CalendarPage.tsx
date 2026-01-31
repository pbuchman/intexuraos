import { useState } from 'react';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Loader2,
  RefreshCw,
  Trash2,
  AlertCircle,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { Button, Layout, RefreshIndicator } from '@/components';
import { useAuth } from '@/context';
import { useCalendarEvents, useFailedCalendarEvents } from '@/hooks';
import { deleteFailedEvent, retryFailedEvent } from '@/services/calendarApi.js';
import { getErrorMessage } from '@intexuraos/common-core/errors';
import type { CalendarEvent, FailedCalendarEvent } from '@/types';
import { formatTime, formatMonthYear } from '@/utils/dateFormat';
import {
  getCurrentMonthRange,
  getMonthRange,
  getCalendarDays,
  isToday,
  stripHtmlTags,
  type MonthRange,
} from '@/utils';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

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

interface EventChipProps {
  event: CalendarEvent;
}

function EventChip({ event }: EventChipProps): React.JSX.Element {
  const allDay = isAllDayEvent(event);
  const hasLink = event.htmlLink !== undefined;

  const handleClick = (e: React.MouseEvent): void => {
    e.stopPropagation();
    if (hasLink) {
      window.open(event.htmlLink, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <div
      role={hasLink ? 'button' : undefined}
      tabIndex={hasLink ? 0 : undefined}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (hasLink && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          handleClick(e as unknown as React.MouseEvent);
        }
      }}
      className={`group mb-0.5 flex items-center gap-1 truncate rounded px-1 py-0.5 text-xs ${
        allDay
          ? 'bg-blue-100 text-blue-800'
          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
      } ${hasLink ? 'cursor-pointer' : ''}`}
      title={`${event.summary}${event.location !== undefined ? ` • ${event.location}` : ''}`}
    >
      {!allDay && (
        <span className="shrink-0 text-slate-500">
          {formatTime(event.start.dateTime ?? undefined, false).replace(' ', '')}
        </span>
      )}
      <span className="truncate">{event.summary}</span>
      {hasLink && (
        <ExternalLink className="hidden h-3 w-3 shrink-0 text-slate-400 group-hover:block" />
      )}
    </div>
  );
}

interface DayCellProps {
  date: Date;
  events: CalendarEvent[];
  isCurrentMonth: boolean;
}

function DayCell({ date, events, isCurrentMonth }: DayCellProps): React.JSX.Element {
  const [showAll, setShowAll] = useState(false);
  const today = isToday(date);
  const maxVisible = 3;
  const hasMore = events.length > maxVisible;
  const visibleEvents = showAll ? events : events.slice(0, maxVisible);

  return (
    <div
      className={`min-h-24 border-b border-r border-slate-200 p-1 ${
        isCurrentMonth ? 'bg-white' : 'bg-slate-50'
      }`}
    >
      <div className="mb-1 flex items-center justify-between">
        <span
          className={`flex h-6 w-6 items-center justify-center rounded-full text-sm ${
            today
              ? 'bg-blue-600 font-semibold text-white'
              : isCurrentMonth
                ? 'text-slate-900'
                : 'text-slate-400'
          }`}
        >
          {date.getDate()}
        </span>
        {hasMore && !showAll && (
          <button
            type="button"
            onClick={() => {
              setShowAll(true);
            }}
            className="text-xs text-blue-600 hover:text-blue-800"
          >
            +{events.length - maxVisible}
          </button>
        )}
        {showAll && hasMore && (
          <button
            type="button"
            onClick={() => {
              setShowAll(false);
            }}
            className="text-xs text-slate-500 hover:text-slate-700"
          >
            less
          </button>
        )}
      </div>
      <div className="space-y-0">
        {visibleEvents.map((event) => (
          <EventChip key={event.id} event={event} />
        ))}
      </div>
    </div>
  );
}

interface CalendarGridProps {
  range: MonthRange;
  events: CalendarEvent[];
}

function CalendarGrid({ range, events }: CalendarGridProps): React.JSX.Element {
  const days = getCalendarDays(range);

  const eventsByDate = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    const date = getEventDate(event);
    const key = date.toDateString();
    const existing = eventsByDate.get(key);
    if (existing !== undefined) {
      existing.push(event);
    } else {
      eventsByDate.set(key, [event]);
    }
  }

  return (
    <div className="overflow-hidden rounded-lg border-l border-t border-slate-200">
      <div className="grid grid-cols-7 bg-slate-100">
        {WEEKDAYS.map((day) => (
          <div
            key={day}
            className="border-b border-r border-slate-200 px-2 py-2 text-center text-xs font-semibold text-slate-600"
          >
            {day}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const dayEvents = eventsByDate.get(day.toDateString()) ?? [];
          const isCurrentMonth = day.getMonth() === range.month;
          return (
            <DayCell
              key={day.toISOString()}
              date={day}
              events={dayEvents}
              isCurrentMonth={isCurrentMonth}
            />
          );
        })}
      </div>
    </div>
  );
}

interface FailedEventCardProps {
  event: FailedCalendarEvent;
  onDelete: (id: string) => Promise<void>;
  onRetry: (id: string) => Promise<void>;
  isDeleting: boolean;
  isRetrying: boolean;
}

function FailedEventCard({
  event,
  onDelete,
  onRetry,
  isDeleting,
  isRetrying,
}: FailedEventCardProps): React.JSX.Element {
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
          <div className="flex shrink-0 gap-1">
            <button
              type="button"
              onClick={() => void onRetry(event.id)}
              disabled={isRetrying || isDeleting}
              className="rounded p-1 text-amber-400 transition-colors hover:bg-amber-100 hover:text-blue-600 disabled:opacity-50"
              aria-label="Retry"
              title="Retry creating event"
            >
              {isRetrying ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
            </button>
            <button
              type="button"
              onClick={() => void onDelete(event.id)}
              disabled={isDeleting || isRetrying}
              className="rounded p-1 text-amber-400 transition-colors hover:bg-amber-100 hover:text-red-600 disabled:opacity-50"
              aria-label="Delete"
              title="Delete failed event"
            >
              {isDeleting ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Trash2 className="h-3 w-3" />
              )}
            </button>
          </div>
        </div>

        {event.description !== null && event.description !== '' && (
          <p className="mb-2 line-clamp-2 text-sm text-amber-700">
            {stripHtmlTags(event.description)}
          </p>
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
  onDelete: (id: string) => Promise<void>;
  onRetry: (id: string) => Promise<void>;
  deletingId: string | null;
  retryingId: string | null;
}

function NeedsAttentionSection({
  events,
  onDelete,
  onRetry,
  deletingId,
  retryingId,
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
          <FailedEventCard
            key={event.id}
            event={event}
            onDelete={onDelete}
            onRetry={onRetry}
            isDeleting={deletingId === event.id}
            isRetrying={retryingId === event.id}
          />
        ))}
      </div>
    </div>
  );
}

export function CalendarPage(): React.JSX.Element {
  const { getAccessToken } = useAuth();
  const [monthRange, setMonthRange] = useState<MonthRange>(getCurrentMonthRange());
  const { events, loading, refreshing, error, setFilters, refresh } = useCalendarEvents({
    timeMin: monthRange.start.toISOString(),
    timeMax: monthRange.end.toISOString(),
  });
  const {
    events: failedEvents,
    loading: failedEventsLoading,
    refresh: refreshFailedEvents,
  } = useFailedCalendarEvents();
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);
  const [deletingFailedEventId, setDeletingFailedEventId] = useState<string | null>(null);
  const [retryingFailedEventId, setRetryingFailedEventId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const handlePrevMonth = (): void => {
    const newMonth = monthRange.month === 0 ? 11 : monthRange.month - 1;
    const newYear = monthRange.month === 0 ? monthRange.year - 1 : monthRange.year;
    const newRange = getMonthRange(newYear, newMonth);
    setMonthRange(newRange);
    setFilters({
      timeMin: newRange.start.toISOString(),
      timeMax: newRange.end.toISOString(),
    });
  };

  const handleNextMonth = (): void => {
    const newMonth = monthRange.month === 11 ? 0 : monthRange.month + 1;
    const newYear = monthRange.month === 11 ? monthRange.year + 1 : monthRange.year;
    const newRange = getMonthRange(newYear, newMonth);
    setMonthRange(newRange);
    setFilters({
      timeMin: newRange.start.toISOString(),
      timeMax: newRange.end.toISOString(),
    });
  };

  const handleToday = (): void => {
    const newRange = getCurrentMonthRange();
    setMonthRange(newRange);
    setFilters({
      timeMin: newRange.start.toISOString(),
      timeMax: newRange.end.toISOString(),
    });
  };

  const handleRefresh = async (): Promise<void> => {
    setIsManualRefreshing(true);
    try {
      await Promise.all([refresh(), refreshFailedEvents()]);
    } finally {
      setIsManualRefreshing(false);
    }
  };

  const handleDeleteFailedEvent = async (id: string): Promise<void> => {
    try {
      setDeletingFailedEventId(id);
      setActionError(null);
      const token = await getAccessToken();
      await deleteFailedEvent(token, id);
      await refreshFailedEvents();
      setSuccessMessage('Failed event deleted');
      setTimeout(() => {
        setSuccessMessage(null);
      }, 3000);
    } catch (e) {
      setActionError(getErrorMessage(e, 'Failed to delete event'));
    } finally {
      setDeletingFailedEventId(null);
    }
  };

  const handleRetryFailedEvent = async (id: string): Promise<void> => {
    try {
      setRetryingFailedEventId(id);
      setActionError(null);
      const token = await getAccessToken();
      await retryFailedEvent(token, id);
      await Promise.all([refreshFailedEvents(), refresh()]);
      setSuccessMessage('Event created successfully');
      setTimeout(() => {
        setSuccessMessage(null);
      }, 5000);
    } catch (e) {
      setActionError(getErrorMessage(e, 'Failed to retry event creation'));
    } finally {
      setRetryingFailedEventId(null);
    }
  };

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
        <button
          onClick={(): void => {
            void handleRefresh();
          }}
          disabled={isManualRefreshing}
          className="rounded p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50"
          title="Refresh"
        >
          <RefreshCw className={`h-5 w-5 ${isManualRefreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <RefreshIndicator show={refreshing || isManualRefreshing} />

      {successMessage !== null && (
        <div className="mb-6 rounded-lg border border-green-200 bg-green-50 p-4 text-green-700">
          {successMessage}
        </div>
      )}

      {actionError !== null && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
          {actionError}
        </div>
      )}

      <NeedsAttentionSection
        events={failedEvents}
        onDelete={handleDeleteFailedEvent}
        onRetry={handleRetryFailedEvent}
        deletingId={deletingFailedEventId}
        retryingId={retryingFailedEventId}
      />

      <div className="mb-6 flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white p-4">
        <Button type="button" variant="ghost" size="sm" onClick={handlePrevMonth}>
          <ChevronLeft className="h-4 w-4" />
        </Button>

        <div className="flex items-center gap-3">
          <CalendarIcon className="h-5 w-5 text-slate-500" />
          <span className="min-w-36 text-center font-medium text-slate-700">
            {formatMonthYear(monthRange.year, monthRange.month)}
          </span>
        </div>

        <Button type="button" variant="ghost" size="sm" onClick={handleNextMonth}>
          <ChevronRight className="h-4 w-4" />
        </Button>

        <Button type="button" variant="secondary" size="sm" onClick={handleToday} className="ml-4">
          Today
        </Button>
      </div>

      {error !== null && error !== '' && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
          {error}
        </div>
      )}

      <CalendarGrid range={monthRange} events={events} />
    </Layout>
  );
}
