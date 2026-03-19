import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, Plus } from 'lucide-react';
import { getErrorMessage } from '@intexuraos/common-core/errors';
import { Button, Card, Layout } from '@/components';
import { useAuth } from '@/context';
import { useCronServices } from '@/hooks';
import { createSchedule as createScheduleApi } from '@/services/cronAgentApi';
import { ServiceSelector } from './ServiceSelector.js';

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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      const schedule = await createScheduleApi(token, {
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

          {/* Services & Available Tools */}
          <ServiceSelector
            services={services}
            servicesLoading={servicesLoading}
            servicesError={servicesError}
            selectedKeys={selectedServiceKeys}
            onToggle={handleToggleService}
            disabled={submitting}
          />

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
