import { Calendar, Clock, MapPin, FileText, AlertCircle, Loader2 } from 'lucide-react';
import type { CalendarPreview } from '@/types';
import { formatDateTime, formatFullDay } from '@/utils/dateFormat';

interface CalendarPreviewCardProps {
  preview: CalendarPreview | null;
  isLoading: boolean;
  error: string | null;
}

export function CalendarPreviewCard({
  preview,
  isLoading,
  error,
}: CalendarPreviewCardProps): React.JSX.Element | null {
  if (isLoading) {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Generating calendar preview...</span>
        </div>
      </div>
    );
  }

  if (error !== null) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
        <div className="flex items-start gap-2">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div>
            <p className="text-sm font-medium text-amber-800">Preview unavailable</p>
            <p className="mt-1 text-sm text-amber-700">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  if (preview === null) {
    return null;
  }

  if (preview.status === 'pending') {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Calendar preview is being generated...</span>
        </div>
      </div>
    );
  }

  if (preview.status === 'failed') {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
        <div className="flex items-start gap-2">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div>
            <p className="text-sm font-medium text-amber-800">Could not generate preview</p>
            {preview.error !== undefined && (
              <p className="mt-1 text-sm text-amber-700">{preview.error}</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-100">
          <Calendar className="h-4 w-4 text-blue-600" />
        </div>
        <div className="flex-1 space-y-2">
          <h4 className="font-medium text-slate-900">{preview.summary ?? 'Untitled Event'}</h4>

          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <Clock className="h-3.5 w-3.5 text-slate-400" />
              <span>
                {preview.isAllDay === true
                  ? preview.start !== undefined
                    ? formatFullDay(preview.start)
                    : 'All day'
                  : preview.start !== undefined
                    ? formatDateTime(preview.start)
                    : 'Not specified'}
                {preview.end !== null &&
                  preview.end !== undefined &&
                  preview.isAllDay !== true &&
                  ` - ${formatDateTime(preview.end)}`}
              </span>
            </div>

            {preview.duration !== null && preview.duration !== undefined && (
              <div className="flex items-center gap-2 text-sm text-slate-600">
                <Clock className="h-3.5 w-3.5 text-slate-400" />
                <span>Duration: {preview.duration}</span>
              </div>
            )}

            {preview.location !== null && preview.location !== undefined && (
              <div className="flex items-center gap-2 text-sm text-slate-600">
                <MapPin className="h-3.5 w-3.5 text-slate-400" />
                <span>{preview.location}</span>
              </div>
            )}

            {preview.description !== null && preview.description !== undefined && (
              <div className="flex items-start gap-2 text-sm text-slate-600">
                <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                <span className="line-clamp-2">{preview.description}</span>
              </div>
            )}
          </div>

          {preview.isAllDay === true && (
            <span className="inline-block rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
              All-day event
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
