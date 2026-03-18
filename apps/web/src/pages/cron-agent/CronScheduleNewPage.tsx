import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { getErrorMessage } from '@intexuraos/common-core/errors';
import { Button, Card, Layout } from '@/components';
import { useAuth } from '@/context';
import { useCronServices } from '@/hooks/useCronServices';
import { createSchedule } from '@/services/cronAgentApi';
import type { ServiceInfo } from '@/types';

const TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Asia/Kolkata',
  'Australia/Sydney',
  'Pacific/Auckland',
] as const;

export function CronScheduleNewPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { getAccessToken } = useAuth();
  const { services, loading: servicesLoading, error: servicesError } = useCronServices();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedServiceKeys, setSelectedServiceKeys] = useState<Set<string>>(new Set());
  const [instruction, setInstruction] = useState('');
  const [timezone, setTimezone] = useState('UTC');
  const [showTools, setShowTools] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedServices: ServiceInfo[] = services.filter((s) =>
    selectedServiceKeys.has(s.key)
  );

  const isValid =
    name.trim().length > 0 &&
    description.trim().length > 0 &&
    selectedServiceKeys.size > 0 &&
    instruction.trim().length > 0;

  const handleToggleService = (key: string): void => {
    setSelectedServiceKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handleSubmit = async (): Promise<void> => {
    if (!isValid) return;

    setSubmitting(true);
    setError(null);

    try {
      const token = await getAccessToken();
      const schedule = await createSchedule(token, {
        name: name.trim(),
        description: description.trim(),
        action: {
          services: Array.from(selectedServiceKeys),
          instruction: instruction.trim(),
        },
        timezone,
      });
      void navigate(`/cron-agent/${schedule.id}`);
    } catch (err) {
      setError(getErrorMessage(err));
      setSubmitting(false);
    }
  };

  const totalToolCount = selectedServices.reduce(
    (sum, s) => sum + s.tools.length,
    0
  );

  return (
    <Layout>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
          New Cron Schedule
        </h2>
        <p className="text-slate-600 dark:text-slate-300">
          Create a new scheduled task for the cron agent
        </p>
      </div>

      <Card className="mb-6">
        <div className="space-y-6">
          {/* Name */}
          <div>
            <label
              htmlFor="schedule-name"
              className="block text-sm font-medium text-slate-700 mb-2 dark:text-slate-200"
            >
              Name <span className="text-red-500">*</span>
            </label>
            <input
              id="schedule-name"
              type="text"
              value={name}
              onChange={(e): void => {
                setName(e.target.value);
              }}
              disabled={submitting}
              placeholder="e.g. Code task dispatcher"
              className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-500 dark:focus:border-blue-400 dark:focus:ring-blue-400/20"
            />
          </div>

          {/* Description */}
          <div>
            <label
              htmlFor="schedule-description"
              className="block text-sm font-medium text-slate-700 mb-2 dark:text-slate-200"
            >
              Description <span className="text-red-500">*</span>
            </label>
            <textarea
              id="schedule-description"
              value={description}
              onChange={(e): void => {
                setDescription(e.target.value);
              }}
              disabled={submitting}
              rows={3}
              placeholder="Describe when this should run, e.g. 'every 5 minutes check if there is a running code task'"
              className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-500 dark:focus:border-blue-400 dark:focus:ring-blue-400/20"
            />
          </div>

          {/* Services */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2 dark:text-slate-200">
              Services <span className="text-red-500">*</span>
            </label>
            {servicesLoading ? (
              <div className="text-sm text-slate-500 dark:text-slate-400">
                Loading available services...
              </div>
            ) : servicesError !== null ? (
              <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                <span>Failed to load services: {servicesError}</span>
              </div>
            ) : services.length === 0 ? (
              <div className="text-sm text-slate-500 dark:text-slate-400">
                No services available
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {services.map((service) => {
                  const isSelected = selectedServiceKeys.has(service.key);
                  return (
                    <button
                      key={service.key}
                      type="button"
                      onClick={(): void => {
                        handleToggleService(service.key);
                      }}
                      disabled={submitting}
                      className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
                        isSelected
                          ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300 dark:border-blue-400'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600'
                      }`}
                    >
                      <span
                        className={`flex h-4 w-4 items-center justify-center rounded border text-xs ${
                          isSelected
                            ? 'border-blue-500 bg-blue-500 text-white dark:border-blue-400 dark:bg-blue-400'
                            : 'border-slate-300 dark:border-slate-500'
                        }`}
                      >
                        {isSelected ? '\u2713' : ''}
                      </span>
                      <span>{service.name}</span>
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-xs ${
                          isSelected
                            ? 'bg-blue-100 text-blue-600 dark:bg-blue-800 dark:text-blue-300'
                            : 'bg-slate-100 text-slate-500 dark:bg-slate-600 dark:text-slate-400'
                        }`}
                      >
                        {String(service.tools.length)} {service.tools.length === 1 ? 'tool' : 'tools'}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            {selectedServiceKeys.size === 0 && !servicesLoading && services.length > 0 && (
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Select at least one service
              </p>
            )}
          </div>

          {/* Available Tools (expandable) */}
          {selectedServices.length > 0 && (
            <div className="rounded-lg border border-slate-200 dark:border-slate-700">
              <button
                type="button"
                onClick={(): void => {
                  setShowTools((prev) => !prev);
                }}
                className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800/50"
              >
                <span>
                  Available Tools ({String(totalToolCount)} across{' '}
                  {String(selectedServices.length)}{' '}
                  {selectedServices.length === 1 ? 'service' : 'services'})
                </span>
                {showTools ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </button>
              {showTools && (
                <div className="border-t border-slate-200 px-4 py-3 dark:border-slate-700">
                  <div className="space-y-4">
                    {selectedServices.map((service) => (
                      <div key={service.key}>
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
                          {service.name}
                        </h4>
                        <ul className="space-y-1.5">
                          {service.tools.map((tool) => (
                            <li
                              key={`${service.key}-${tool.name}`}
                              className="text-sm"
                            >
                              <span className="font-mono text-xs font-medium text-slate-800 dark:text-slate-200">
                                {tool.name}
                              </span>
                              {tool.description !== '' && (
                                <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">
                                  {tool.description}
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Instruction */}
          <div>
            <label
              htmlFor="schedule-instruction"
              className="block text-sm font-medium text-slate-700 mb-2 dark:text-slate-200"
            >
              Instruction <span className="text-red-500">*</span>
            </label>
            <textarea
              id="schedule-instruction"
              value={instruction}
              onChange={(e): void => {
                setInstruction(e.target.value);
              }}
              disabled={submitting}
              rows={4}
              placeholder="Describe what to do step by step, e.g. 'check if any code task is running. if not, pick the oldest executable and dispatch it'"
              className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-500 dark:focus:border-blue-400 dark:focus:ring-blue-400/20"
            />
          </div>

          {/* Timezone */}
          <div>
            <label
              htmlFor="schedule-timezone"
              className="block text-sm font-medium text-slate-700 mb-2 dark:text-slate-200"
            >
              Timezone
            </label>
            <select
              id="schedule-timezone"
              value={timezone}
              onChange={(e): void => {
                setTimezone(e.target.value);
              }}
              disabled={submitting}
              className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-blue-400 dark:focus:ring-blue-400/20"
            >
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Card>

      {/* Error display */}
      {error !== null ? (
        <div className="mb-6 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/30">
          <AlertCircle className="h-5 w-5 flex-shrink-0 text-red-600 dark:text-red-400" />
          <div>
            <h3 className="font-medium text-red-800 dark:text-red-300">
              Failed to create schedule
            </h3>
            <p className="mt-1 text-sm text-red-700 dark:text-red-400">
              {error}
            </p>
          </div>
        </div>
      ) : null}

      {/* Actions */}
      <div className="flex gap-3">
        <Button
          onClick={(): void => {
            void handleSubmit();
          }}
          disabled={!isValid}
          isLoading={submitting}
          loadingText="Creating schedule..."
        >
          <Plus className="h-4 w-4 sm:mr-2" />
          <span className="hidden sm:inline">Create Schedule</span>
        </Button>
        <Button
          variant="secondary"
          onClick={(): void => {
            void navigate('/cron-agent');
          }}
          disabled={submitting}
        >
          Cancel
        </Button>
      </div>
    </Layout>
  );
}
