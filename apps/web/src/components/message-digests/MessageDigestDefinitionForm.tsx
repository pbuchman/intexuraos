import {
  CheckCircle2,
  ChevronRight,
  Eye,
  LoaderCircle,
  MessageCircleMore,
  PencilLine,
  Send,
  Sparkles,
  UsersRound,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DIRECT_SENTIMENT_MESSAGE_DIGEST_INSTRUCTIONS,
  FISHING_GROUP_MESSAGE_DIGEST_INSTRUCTIONS,
} from '@intexuraos/llm-prompts/message-digest/templates';
import { Modal } from '@/components/ui/Modal';
import { useAuth } from '@/context';
import { previewMessageDigest, previewMessageDigestSchedule } from '@/services/messageDigestsApi';
import type {
  CreateMessageDigestInput,
  MessageDigestDeliveryReadiness,
  MessageDigestInstructionTemplateId,
  MessageDigestPreview,
  MessageDigestSchedule,
  MessageDigestSchedulePreview,
} from '@/types/messageDigests';
import { formatMessageDigestDateTime, isValidMessageDigestTimeZone } from '@/types/messageDigests';
import { formatRelative } from '@/utils/dateFormat';
import {
  MessageDigestConversationPicker,
  type MessageDigestConversationSelection,
} from './MessageDigestConversationPicker.js';
import { MessageDigestMarkdown } from './MessageDigestMarkdown.js';
import { MessageDigestScheduleFields } from './MessageDigestScheduleFields.js';

const NAME_MAX_LENGTH = 80;
const INSTRUCTIONS_MIN_LENGTH = 20;
const INSTRUCTIONS_MAX_LENGTH = 4_000;
const LOCAL_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;

interface InstructionTemplate {
  id: MessageDigestInstructionTemplateId;
  label: string;
  description: string;
  instructions: string | null;
}

const INSTRUCTION_TEMPLATES: readonly InstructionTemplate[] = [
  {
    id: 'fishing_group',
    label: 'Fishing group',
    description: 'High-signal facts, decisions, moderators, topics, and open threads.',
    instructions: FISHING_GROUP_MESSAGE_DIGEST_INSTRUCTIONS,
  },
  {
    id: 'direct_sentiment',
    label: 'Sentiment and outcomes',
    description: 'Expressed sentiment, shifts, concerns, commitments, and factual outcomes.',
    instructions: DIRECT_SENTIMENT_MESSAGE_DIGEST_INSTRUCTIONS,
  },
  {
    id: 'custom',
    label: 'Custom instructions',
    description: 'Write exactly what this digest should notice and summarize.',
    instructions: null,
  },
];

export interface MessageDigestFormValue {
  status: 'active' | 'paused';
  name: string;
  source: MessageDigestConversationSelection | null;
  sourceLocked: boolean;
  instructions: {
    templateId: MessageDigestInstructionTemplateId;
    text: string;
  };
  schedule: MessageDigestSchedule;
}

export interface MessageDigestDefinitionFormProps {
  mode: 'create' | 'edit';
  initialValue?: MessageDigestFormValue;
  deliveryReadiness: MessageDigestDeliveryReadiness | null;
  deliveryReadinessLoading: boolean;
  deliveryReadinessError: string | null;
  isSubmitting: boolean;
  submitError: string | null;
  onSubmit: (input: CreateMessageDigestInput) => Promise<void>;
  onCancel: (dirty: boolean) => void;
  onRefreshDeliveryReadiness?: () => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
}

interface FormErrors {
  name?: string | undefined;
  source?: string | undefined;
  instructions?: string | undefined;
  localTime?: string | undefined;
  timeZone?: string | undefined;
}

interface FormValidation {
  errors: FormErrors;
  input: CreateMessageDigestInput | null;
}

export function MessageDigestDefinitionForm({
  mode,
  initialValue,
  deliveryReadiness,
  deliveryReadinessLoading,
  deliveryReadinessError,
  isSubmitting,
  submitError,
  onSubmit,
  onCancel,
  onRefreshDeliveryReadiness,
  onDirtyChange,
}: MessageDigestDefinitionFormProps): React.JSX.Element {
  const { getAccessToken } = useAuth();
  const [value, setValue] = useState<MessageDigestFormValue>(
    () => initialValue ?? createDefaultFormValue()
  );
  const initialSnapshotRef = useRef(serializeFormValue(initialValue ?? value));
  const [errors, setErrors] = useState<FormErrors>({});
  const [validationAttempted, setValidationAttempted] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pendingTemplate, setPendingTemplate] = useState<Exclude<
    MessageDigestInstructionTemplateId,
    'custom'
  > | null>(null);
  const [schedulePreview, setSchedulePreview] = useState<MessageDigestSchedulePreview | null>(null);
  const [schedulePreviewLoading, setSchedulePreviewLoading] = useState(false);
  const [schedulePreviewError, setSchedulePreviewError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewResult, setPreviewResult] = useState<MessageDigestPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);
  const sourceTriggerRef = useRef<HTMLButtonElement | null>(null);
  const instructionsRef = useRef<HTMLTextAreaElement | null>(null);
  const localTimeRef = useRef<HTMLInputElement | null>(null);
  const timeZoneRef = useRef<HTMLSelectElement | null>(null);
  const previewTriggerRef = useRef<HTMLButtonElement | null>(null);
  const scheduleRequestSequenceRef = useRef(0);
  const previewRequestSequenceRef = useRef(0);
  const previewControllerRef = useRef<AbortController | null>(null);
  const dirty = serializeFormValue(value) !== initialSnapshotRef.current;
  const timeZones = useMemo(() => getTimeZones(value.schedule.timeZone), [value.schedule.timeZone]);
  const currentValidation = useMemo(() => validateFormValue(value), [value]);
  const invalidFieldCount = Object.keys(currentValidation.errors).length;

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    if (!validationAttempted) return;
    setErrors(currentValidation.errors);
  }, [currentValidation, validationAttempted]);

  useEffect(() => {
    if (!dirty) return;
    const preventUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', preventUnload);
    return (): void => {
      window.removeEventListener('beforeunload', preventUnload);
    };
  }, [dirty]);

  useEffect(() => {
    const requestId = scheduleRequestSequenceRef.current + 1;
    scheduleRequestSequenceRef.current = requestId;
    const schedule = value.schedule;
    if (!isValidSchedule(schedule)) {
      setSchedulePreview(null);
      setSchedulePreviewLoading(false);
      setSchedulePreviewError(null);
      return;
    }

    const controller = new AbortController();
    setSchedulePreviewLoading(true);
    setSchedulePreviewError(null);
    const timer = window.setTimeout(() => {
      void (async (): Promise<void> => {
        try {
          const accessToken = await getAccessToken();
          if (scheduleRequestSequenceRef.current !== requestId) return;
          const nextPreview = await previewMessageDigestSchedule(
            accessToken,
            { schedule },
            { signal: controller.signal, refreshToken: getAccessToken }
          );
          if (scheduleRequestSequenceRef.current !== requestId) return;
          setSchedulePreview(nextPreview);
        } catch (requestError) {
          if (scheduleRequestSequenceRef.current !== requestId || controller.signal.aborted) return;
          setSchedulePreview(null);
          setSchedulePreviewError(getDisplayError(requestError, 'Schedule preview unavailable'));
        } finally {
          if (scheduleRequestSequenceRef.current === requestId) {
            setSchedulePreviewLoading(false);
          }
        }
      })();
    }, 200);

    return (): void => {
      window.clearTimeout(timer);
      controller.abort();
      scheduleRequestSequenceRef.current += 1;
    };
  }, [getAccessToken, value.schedule]);

  useEffect(() => {
    return (): void => {
      previewRequestSequenceRef.current += 1;
      previewControllerRef.current?.abort();
    };
  }, []);

  const clearFormErrors = (...keys: (keyof FormErrors)[]): void => {
    setErrors((current) => {
      let next = current;
      for (const key of keys) next = { ...next, [key]: undefined };
      return next;
    });
  };

  const updateValue = <K extends keyof MessageDigestFormValue>(
    key: K,
    next: MessageDigestFormValue[K],
    errorKey?: keyof FormErrors
  ): void => {
    setValue((current) => ({ ...current, [key]: next }));
    if (errorKey !== undefined) clearFormErrors(errorKey);
  };

  const selectConversation = (selection: MessageDigestConversationSelection): void => {
    setValue((current) => {
      const sourceTypeChanged = current.source?.chatType !== selection.chatType;
      const shouldInsertDefault =
        current.instructions.text.trim() === '' ||
        (sourceTypeChanged && isUntouchedInstructionTemplate(current.instructions));
      const defaultTemplate = getDefaultTemplate(selection.chatType);
      return {
        ...current,
        source: selection,
        instructions: shouldInsertDefault
          ? { templateId: defaultTemplate.id, text: defaultTemplate.instructions ?? '' }
          : current.instructions,
      };
    });
    clearFormErrors('source', 'instructions');
  };

  const requestTemplate = (template: InstructionTemplate): void => {
    if (template.id === 'custom') {
      setValue((current) => ({
        ...current,
        instructions: { ...current.instructions, templateId: 'custom' },
      }));
      window.setTimeout(() => instructionsRef.current?.focus(), 0);
      return;
    }
    if (
      value.instructions.text.trim() === '' ||
      value.instructions.text === template.instructions
    ) {
      applyTemplate(template.id);
      return;
    }
    setPendingTemplate(template.id);
  };

  const applyTemplate = (
    templateId: Exclude<MessageDigestInstructionTemplateId, 'custom'>
  ): void => {
    const template = INSTRUCTION_TEMPLATES.find((item) => item.id === templateId);
    if (template?.instructions === null || template?.instructions === undefined) return;
    setValue((current) => ({
      ...current,
      instructions: { templateId, text: template.instructions ?? '' },
    }));
    clearFormErrors('instructions');
    setPendingTemplate(null);
  };

  const validateAndFocus = (): CreateMessageDigestInput | null => {
    const validation = currentValidation;
    setValidationAttempted(true);
    setErrors(validation.errors);
    if (validation.input !== null) return validation.input;
    if (validation.errors.name !== undefined) nameRef.current?.focus();
    else if (validation.errors.source !== undefined) sourceTriggerRef.current?.focus();
    else if (validation.errors.instructions !== undefined) instructionsRef.current?.focus();
    else if (validation.errors.localTime !== undefined) localTimeRef.current?.focus();
    else if (validation.errors.timeZone !== undefined) timeZoneRef.current?.focus();
    return null;
  };

  const submit = async (): Promise<void> => {
    const input = validateAndFocus();
    if (input === null) return;
    await onSubmit(input);
  };

  const runPreview = async (): Promise<void> => {
    const input = validateAndFocus();
    if (input === null) return;
    setPreviewOpen(true);
    setPreviewLoading(true);
    setPreviewError(null);
    setPreviewResult(null);
    previewRequestSequenceRef.current += 1;
    const requestId = previewRequestSequenceRef.current;
    previewControllerRef.current?.abort();
    const controller = new AbortController();
    previewControllerRef.current = controller;
    try {
      const accessToken = await getAccessToken();
      if (previewRequestSequenceRef.current !== requestId) return;
      const result = await previewMessageDigest(
        accessToken,
        {
          source: input.source,
          instructions: input.instructions,
          schedule: input.schedule,
        },
        { signal: controller.signal, refreshToken: getAccessToken }
      );
      if (previewRequestSequenceRef.current !== requestId) return;
      setPreviewResult(result);
    } catch (requestError) {
      if (previewRequestSequenceRef.current !== requestId || controller.signal.aborted) return;
      setPreviewError(getDisplayError(requestError, 'Digest preview unavailable'));
    } finally {
      if (previewRequestSequenceRef.current === requestId) setPreviewLoading(false);
    }
  };

  const closePreview = (): void => {
    previewRequestSequenceRef.current += 1;
    previewControllerRef.current?.abort();
    setPreviewOpen(false);
  };

  return (
    <>
      <form
        noValidate
        className="flex min-w-0 flex-col gap-5"
        onSubmit={(event): void => {
          event.preventDefault();
          void submit();
        }}
      >
        {submitError !== null ? (
          <div
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200"
          >
            {submitError}
          </div>
        ) : null}

        {validationAttempted && invalidFieldCount > 0 ? (
          <div
            role="alert"
            className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
          >
            Fix {String(invalidFieldCount)} {invalidFieldCount === 1 ? 'field' : 'fields'} before
            saving.
          </div>
        ) : null}

        <FormSection
          number="1"
          title="Digest details"
          description="Give this summary a clear name and choose whether it should run automatically."
        >
          <label className="block">
            <span className="flex items-center justify-between gap-3 text-sm font-semibold text-slate-800 dark:text-slate-200">
              <span>Digest name</span>
              <span
                id="digest-name-count"
                className="text-xs font-normal tabular-nums text-slate-500"
              >
                {String(value.name.length)} / {String(NAME_MAX_LENGTH)}
              </span>
            </span>
            <input
              ref={nameRef}
              value={value.name}
              maxLength={NAME_MAX_LENGTH + 1}
              aria-label="Digest name"
              aria-invalid={errors.name !== undefined}
              aria-describedby={`${errors.name === undefined ? 'digest-name-help' : 'digest-name-error'} digest-name-count`}
              onChange={(event): void => {
                updateValue('name', event.target.value, 'name');
              }}
              className="mt-1.5 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              placeholder="e.g. Fishing group daily briefing"
            />
            {errors.name !== undefined ? (
              <span
                id="digest-name-error"
                role="alert"
                className="mt-1.5 block text-sm text-red-600 dark:text-red-400"
              >
                {errors.name}
              </span>
            ) : (
              <span
                id="digest-name-help"
                className="mt-1.5 block text-xs text-slate-500 dark:text-slate-400"
              >
                Shown only in your Message Digests workspace.
              </span>
            )}
          </label>

          <fieldset>
            <legend className="text-sm font-semibold text-slate-800 dark:text-slate-200">
              Automation
            </legend>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <StatusChoice
                checked={value.status === 'active'}
                title="Active"
                description="Run on schedule when WhatsApp delivery is ready."
                onSelect={(): void => {
                  updateValue('status', 'active');
                }}
              />
              <StatusChoice
                checked={value.status === 'paused'}
                title="Paused"
                description="Save the setup without automatic delivery."
                onSelect={(): void => {
                  updateValue('status', 'paused');
                }}
              />
            </div>
          </fieldset>
        </FormSection>

        <FormSection
          number="2"
          title="Source conversation"
          description="Choose one mirrored WhatsApp group or one direct conversation. The original chat is never modified."
        >
          {value.source === null ? (
            <div
              className={`rounded-xl border border-dashed p-5 ${errors.source === undefined ? 'border-slate-300 dark:border-slate-700' : 'border-red-400 bg-red-50 dark:border-red-800 dark:bg-red-950/20'}`}
            >
              <p className="text-sm text-slate-600 dark:text-slate-400">
                No conversation selected.
              </p>
              <button
                ref={sourceTriggerRef}
                type="button"
                aria-invalid={errors.source !== undefined}
                aria-describedby={errors.source === undefined ? undefined : 'digest-source-error'}
                onClick={(): void => {
                  setPickerOpen(true);
                }}
                className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900"
              >
                <MessageCircleMore aria-hidden="true" className="h-4 w-4" />
                Choose conversation
              </button>
              {errors.source !== undefined ? (
                <p
                  id="digest-source-error"
                  role="alert"
                  className="mt-2 text-sm text-red-600 dark:text-red-400"
                >
                  {errors.source}
                </p>
              ) : null}
            </div>
          ) : (
            <div className="flex min-w-0 flex-col gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950/40 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                  {value.source.chatType === 'group' ? (
                    <UsersRound aria-hidden="true" className="h-5 w-5" />
                  ) : (
                    <MessageCircleMore aria-hidden="true" className="h-5 w-5" />
                  )}
                </span>
                <div className="min-w-0">
                  <p className="break-words text-sm font-semibold text-slate-950 dark:text-slate-50">
                    {value.source.displayName}
                  </p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {value.source.chatType === 'group' ? 'WhatsApp group' : 'Direct conversation'} ·
                    Private Mirror
                  </p>
                  {value.source.messageCount === undefined ? (
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      Activity snapshot unavailable
                    </p>
                  ) : (
                    <p className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                      <span>{String(value.source.messageCount)} messages</span>
                      {value.source.participantCount === undefined ? null : (
                        <span>{String(value.source.participantCount)} participants</span>
                      )}
                      {value.source.lastActivityAt === undefined ? (
                        <span>Last activity unavailable</span>
                      ) : (
                        <span>Active {formatRelative(value.source.lastActivityAt)}</span>
                      )}
                    </p>
                  )}
                </div>
              </div>
              <button
                ref={sourceTriggerRef}
                type="button"
                disabled={value.sourceLocked}
                onClick={(): void => {
                  setPickerOpen(true);
                }}
                className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              >
                Change conversation
              </button>
            </div>
          )}
          {value.sourceLocked ? (
            <p className="text-sm text-amber-700 dark:text-amber-300">
              The source can’t be changed after the first run, which preserves digest continuity.
            </p>
          ) : null}
        </FormSection>

        <FormSection
          number="3"
          title="Digest instructions"
          description="Choose a proven starting point, then edit it freely so the summary reflects what matters to you."
        >
          <div className="grid gap-3 md:grid-cols-3">
            {INSTRUCTION_TEMPLATES.map((template) => (
              <button
                key={template.id}
                type="button"
                aria-label={template.label}
                aria-pressed={value.instructions.templateId === template.id}
                onClick={(): void => {
                  requestTemplate(template);
                }}
                className={`min-h-24 rounded-xl border p-3 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${value.instructions.templateId === template.id ? 'border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-950/40' : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800'}`}
              >
                <span className="flex items-center gap-2 text-sm font-semibold text-slate-950 dark:text-slate-50">
                  {template.id === 'custom' ? (
                    <PencilLine aria-hidden="true" className="h-4 w-4 text-slate-500" />
                  ) : (
                    <Sparkles
                      aria-hidden="true"
                      className="h-4 w-4 text-blue-600 dark:text-blue-400"
                    />
                  )}
                  {template.label}
                </span>
                <span className="mt-1.5 block text-xs leading-5 text-slate-500 dark:text-slate-400">
                  {template.description}
                </span>
              </button>
            ))}
          </div>
          <label className="block">
            <span className="flex items-center justify-between gap-3 text-sm font-semibold text-slate-800 dark:text-slate-200">
              <span>Summary instructions</span>
              <span
                id="digest-instructions-count"
                className="text-xs font-normal tabular-nums text-slate-500"
              >
                {String(value.instructions.text.length)} / {String(INSTRUCTIONS_MAX_LENGTH)}
              </span>
            </span>
            <textarea
              ref={instructionsRef}
              value={value.instructions.text}
              maxLength={INSTRUCTIONS_MAX_LENGTH + 1}
              rows={9}
              aria-label="Summary instructions"
              aria-invalid={errors.instructions !== undefined}
              aria-describedby={`${errors.instructions === undefined ? 'digest-instructions-help' : 'digest-instructions-error'} digest-instructions-count`}
              onChange={(event): void => {
                setValue((current) => ({
                  ...current,
                  instructions: { ...current.instructions, text: event.target.value },
                }));
                clearFormErrors('instructions');
              }}
              className="mt-1.5 w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm leading-6 text-slate-950 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
            {errors.instructions !== undefined ? (
              <span
                id="digest-instructions-error"
                role="alert"
                className="mt-1.5 block text-sm text-red-600 dark:text-red-400"
              >
                {errors.instructions}
              </span>
            ) : (
              <span
                id="digest-instructions-help"
                className="mt-1.5 block text-xs text-slate-500 dark:text-slate-400"
              >
                The model must support every factual statement with messages from the selected
                window.
              </span>
            )}
          </label>
        </FormSection>

        <FormSection
          number="4"
          title="Schedule and delivery"
          description="Choose the local calendar schedule. The service calculates the exact window and sends to your first mapped WhatsApp number."
        >
          <MessageDigestScheduleFields
            value={value.schedule}
            onChange={(schedule): void => {
              updateValue('schedule', schedule);
              clearFormErrors('localTime', 'timeZone');
            }}
            timeZones={timeZones}
            preview={schedulePreview}
            previewLoading={schedulePreviewLoading}
            previewError={schedulePreviewError}
            readiness={deliveryReadiness}
            readinessLoading={deliveryReadinessLoading}
            readinessError={deliveryReadinessError}
            activeRequested={value.status === 'active'}
            localTimeError={errors.localTime}
            timeZoneError={errors.timeZone}
            localTimeRef={localTimeRef}
            timeZoneRef={timeZoneRef}
            {...(onRefreshDeliveryReadiness === undefined
              ? {}
              : { onRefreshReadiness: onRefreshDeliveryReadiness })}
          />
        </FormSection>

        <div className="sticky bottom-0 z-10 flex flex-col-reverse gap-2 rounded-xl border border-slate-200 bg-white/95 p-3 shadow-lg backdrop-blur dark:border-slate-700 dark:bg-slate-900/95 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            disabled={isSubmitting}
            onClick={(): void => {
              onCancel(dirty);
            }}
            className="inline-flex min-h-11 items-center justify-center rounded-lg px-4 text-sm font-semibold text-slate-700 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <button
              ref={previewTriggerRef}
              type="button"
              disabled={isSubmitting}
              onClick={(): void => void runPreview()}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-blue-300 bg-white px-4 text-sm font-semibold text-blue-700 hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 dark:border-blue-800 dark:bg-slate-900 dark:text-blue-300 dark:hover:bg-blue-950/40"
            >
              <Eye aria-hidden="true" className="h-4 w-4" />
              Preview summary
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 text-sm font-semibold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-blue-500 dark:hover:bg-blue-600 dark:focus:ring-offset-slate-900"
            >
              {isSubmitting ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="h-4 w-4 animate-spin motion-reduce:animate-none"
                />
              ) : (
                <Send aria-hidden="true" className="h-4 w-4" />
              )}
              {isSubmitting ? 'Saving…' : mode === 'create' ? 'Create digest' : 'Save changes'}
            </button>
          </div>
        </div>
      </form>

      <MessageDigestConversationPicker
        open={pickerOpen}
        value={value.source}
        onOpenChange={setPickerOpen}
        onSelect={selectConversation}
        returnFocusRef={sourceTriggerRef}
      />

      <Modal
        open={pendingTemplate !== null}
        onOpenChange={(open): void => {
          if (!open) setPendingTemplate(null);
        }}
        title="Replace current instructions?"
        description="The selected template will replace all text currently in the editor."
        size="sm"
        returnFocusRef={instructionsRef}
      >
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={(): void => {
              setPendingTemplate(null);
            }}
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            Keep current instructions
          </button>
          <button
            type="button"
            onClick={(): void => {
              if (pendingTemplate !== null) applyTemplate(pendingTemplate);
            }}
            className="inline-flex min-h-11 items-center justify-center rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-slate-800"
          >
            Replace instructions
          </button>
        </div>
      </Modal>

      <DigestPreviewDialog
        open={previewOpen}
        loading={previewLoading}
        error={previewError}
        result={previewResult}
        returnFocusRef={previewTriggerRef}
        onClose={closePreview}
        onRetry={runPreview}
      />
    </>
  );
}

function FormSection({
  number,
  title,
  description,
  children,
}: {
  number: string;
  title: string;
  description: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-6">
      <header className="mb-5 flex min-w-0 gap-3">
        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-100 text-sm font-bold text-blue-700 dark:bg-blue-950 dark:text-blue-300">
          {number}
        </span>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-50">{title}</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-400">{description}</p>
        </div>
      </header>
      <div className="grid min-w-0 gap-5">{children}</div>
    </section>
  );
}

function StatusChoice({
  checked,
  title,
  description,
  onSelect,
}: {
  checked: boolean;
  title: string;
  description: string;
  onSelect: () => void;
}): React.JSX.Element {
  return (
    <label
      className={`flex min-h-20 cursor-pointer gap-3 rounded-xl border p-3 ${checked ? 'border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-950/40' : 'border-slate-200 dark:border-slate-700'}`}
    >
      <input
        type="radio"
        name="digest-status"
        checked={checked}
        onChange={onSelect}
        className="mt-1 h-4 w-4"
      />
      <span>
        <span className="block text-sm font-semibold text-slate-950 dark:text-slate-50">
          {title}
        </span>
        <span className="mt-1 block text-xs leading-5 text-slate-500 dark:text-slate-400">
          {description}
        </span>
      </span>
    </label>
  );
}

function DigestPreviewDialog({
  open,
  loading,
  error,
  result,
  returnFocusRef,
  onClose,
  onRetry,
}: {
  open: boolean;
  loading: boolean;
  error: string | null;
  result: MessageDigestPreview | null;
  returnFocusRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  onRetry: () => Promise<void>;
}): React.JSX.Element {
  return (
    <Modal
      open={open}
      onOpenChange={(nextOpen): void => {
        if (!nextOpen) onClose();
      }}
      title="Digest preview"
      description="Generated from the current form without saving or sending anything."
      hideTitle
      padded={false}
      returnFocusRef={returnFocusRef}
      contentClassName="fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl dark:bg-slate-900 sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-[min(48rem,calc(100vw-2rem))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl"
    >
      <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-4 dark:border-slate-800 sm:px-6">
        <div>
          <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-50">
            Digest preview
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Nothing is saved or sent from preview.
          </p>
        </div>
        <button
          type="button"
          aria-label="Close preview"
          onClick={onClose}
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:hover:bg-slate-800"
        >
          <X aria-hidden="true" className="h-5 w-5" />
        </button>
      </header>
      <div className="min-h-48 overflow-y-auto p-4 sm:p-6">
        {loading ? (
          <div
            role="status"
            className="flex min-h-48 items-center justify-center gap-2 text-sm text-slate-600 dark:text-slate-400"
          >
            <LoaderCircle
              aria-hidden="true"
              className="h-5 w-5 animate-spin text-blue-600 motion-reduce:animate-none"
            />
            Generating a private preview…
          </div>
        ) : null}
        {!loading && error !== null ? (
          <div
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200"
          >
            <p>{error}</p>
            <button
              type="button"
              onClick={(): void => void onRetry()}
              className="mt-3 inline-flex min-h-11 items-center rounded-lg bg-red-700 px-4 font-semibold text-white hover:bg-red-800 focus:outline-none focus:ring-2 focus:ring-red-500"
            >
              Try preview again
            </button>
          </div>
        ) : null}
        {!loading && error === null && result?.status === 'no_activity' ? (
          <div className="flex min-h-48 flex-col items-center justify-center text-center">
            <CheckCircle2 aria-hidden="true" className="h-9 w-9 text-slate-400" />
            <h3 className="mt-3 font-semibold text-slate-950 dark:text-slate-50">
              No new activity in this window
            </h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              The digest would be skipped and no WhatsApp message would be created.
            </p>
          </div>
        ) : null}
        {!loading && error === null && result?.status === 'generated' && result.content !== null ? (
          <article className="min-w-0">
            <div className="mb-5 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm dark:border-slate-700 dark:bg-slate-950/40">
              <p className="font-semibold text-slate-900 dark:text-slate-100">
                {result.source.displayName} · {String(result.messageCount)} messages
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {formatMessageDigestDateTime(result.window.start, result.window.timeZone)}{' '}
                <ChevronRight aria-hidden="true" className="inline h-3 w-3" />{' '}
                {formatMessageDigestDateTime(result.window.end, result.window.timeZone)}
              </p>
            </div>
            <h3 className="text-xl font-bold text-slate-950 dark:text-slate-50">
              {result.content.headline}
            </h3>
            <MessageDigestMarkdown
              markdown={result.content.summaryMarkdown}
              className="prose prose-slate mt-4 max-w-none break-words text-sm dark:prose-invert"
            />
          </article>
        ) : null}
      </div>
      <footer className="flex justify-end border-t border-slate-200 bg-slate-50 px-4 py-4 dark:border-slate-800 dark:bg-slate-950/50 sm:px-6">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex min-h-11 items-center rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-500 dark:bg-slate-100 dark:text-slate-900"
        >
          Close preview
        </button>
      </footer>
    </Modal>
  );
}

function getDefaultTemplate(chatType: 'group' | 'direct'): InstructionTemplate {
  const templateId = chatType === 'group' ? 'fishing_group' : 'direct_sentiment';
  const template = INSTRUCTION_TEMPLATES.find((item) => item.id === templateId);
  if (template === undefined) throw new Error('Message Digest instruction template is missing');
  return template;
}

function isUntouchedInstructionTemplate(
  instructions: MessageDigestFormValue['instructions']
): boolean {
  if (instructions.templateId === 'custom') return false;
  const template = INSTRUCTION_TEMPLATES.find((item) => item.id === instructions.templateId);
  return template?.instructions !== null && template?.instructions === instructions.text;
}

function createDefaultFormValue(): MessageDigestFormValue {
  const resolvedTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return {
    status: 'active',
    name: '',
    source: null,
    sourceLocked: false,
    instructions: { templateId: 'custom', text: '' },
    schedule: { kind: 'daily', localTime: '08:00', timeZone: resolvedTimeZone || 'UTC' },
  };
}

function serializeFormValue(value: MessageDigestFormValue): string {
  return JSON.stringify(value);
}

function validateFormValue(value: MessageDigestFormValue): FormValidation {
  const errors: FormErrors = {};
  const name = value.name.trim();
  const instructions = value.instructions.text.trim();
  const timeZone = value.schedule.timeZone.trim();

  if (name === '') errors.name = 'Enter a digest name.';
  else if (name.length > NAME_MAX_LENGTH) {
    errors.name = `Digest name must be ${String(NAME_MAX_LENGTH)} characters or fewer.`;
  }
  if (value.source === null) errors.source = 'Choose a WhatsApp conversation.';
  if (instructions.length < INSTRUCTIONS_MIN_LENGTH) {
    errors.instructions = `Instructions must contain at least ${String(INSTRUCTIONS_MIN_LENGTH)} characters.`;
  } else if (instructions.length > INSTRUCTIONS_MAX_LENGTH) {
    errors.instructions = `Instructions must be ${String(INSTRUCTIONS_MAX_LENGTH)} characters or fewer.`;
  }
  if (!LOCAL_TIME_PATTERN.test(value.schedule.localTime)) {
    errors.localTime = 'Choose a valid delivery time.';
  }
  if (!isValidMessageDigestTimeZone(timeZone)) {
    errors.timeZone = 'Choose a valid IANA time zone.';
  }
  if (Object.keys(errors).length > 0 || value.source === null) {
    return { errors, input: null };
  }

  const schedule: MessageDigestSchedule =
    value.schedule.kind === 'weekly'
      ? {
          kind: 'weekly',
          weekday: value.schedule.weekday,
          localTime: value.schedule.localTime,
          timeZone,
        }
      : {
          kind: value.schedule.kind,
          localTime: value.schedule.localTime,
          timeZone,
        };

  return {
    errors,
    input: {
      status: value.status,
      name,
      source: { chatId: value.source.chatId },
      instructions: { templateId: value.instructions.templateId, text: instructions },
      schedule,
    },
  };
}

function isValidSchedule(schedule: MessageDigestFormValue['schedule']): boolean {
  return (
    LOCAL_TIME_PATTERN.test(schedule.localTime) && isValidMessageDigestTimeZone(schedule.timeZone)
  );
}

function getTimeZones(current: string): string[] {
  let supported: string[] = [];
  try {
    supported = Intl.supportedValuesOf('timeZone');
  } catch {
    supported = [];
  }
  const browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  return [
    ...new Set([current, browserTimeZone, 'UTC', ...supported].filter((item) => item !== '')),
  ].sort();
}

function getDisplayError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() !== '' ? error.message : fallback;
}
