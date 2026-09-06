import { AlertTriangle, ArrowLeft, Newspaper, RefreshCw } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import {
  MessageDigestDefinitionForm,
  type MessageDigestFormValue,
} from '@/components/message-digests/MessageDigestDefinitionForm';
import { MessageDigestPageLoading } from '@/components/message-digests/MessageDigestPageLoading';
import { Modal } from '@/components/ui/Modal';
import {
  useMessageDigestCommands,
  useMessageDigestDefinition,
  useMessageDigestDeliveryReadiness,
} from '@/hooks/useMessageDigests';
import { useUnsavedMessageDigestNavigation } from '@/hooks/useUnsavedMessageDigestNavigation';
import type {
  CreateMessageDigestInput,
  MessageDigestDefinition,
  MessageDigestSchedule,
  UpdateMessageDigestCommand,
} from '@/types/messageDigests';

export function WhatsAppMessageDigestEditPage(): React.JSX.Element {
  const { definitionId = '' } = useParams<{ definitionId: string }>();
  const navigate = useNavigate();
  const digest = useMessageDigestDefinition(definitionId);
  const commands = useMessageDigestCommands();
  const delivery = useMessageDigestDeliveryReadiness();
  const [dirty, setDirty] = useState(false);
  const [reloadError, setReloadError] = useState<string | null>(null);
  const unsavedNavigation = useUnsavedMessageDigestNavigation(dirty);

  const leaveEditor = useCallback((): void => {
    void navigate(`/whatsapp/message-digests/${definitionId}`);
  }, [definitionId, navigate]);

  if (digest.isLoading) {
    return <MessageDigestPageLoading title="Edit Message Digest" />;
  }
  if (digest.isNotFound || definitionId === '') {
    return <MessageDigestNotFound />;
  }
  if (digest.definition === null) {
    return (
      <MessageDigestLoadError
        message={digest.error ?? 'Message Digest is temporarily unavailable.'}
        onRetry={digest.refresh}
      />
    );
  }

  const definition = digest.definition;
  const update = async (input: CreateMessageDigestInput): Promise<void> => {
    const patch = buildUpdatePatch(definition, input);
    if (Object.keys(patch).length === 0) {
      unsavedNavigation.disarm();
      leaveEditor();
      return;
    }
    const updated = await commands.updateDigest(definition.id, {
      expectedRevision: definition.revision,
      patch,
    });
    if (updated !== null) {
      unsavedNavigation.disarm();
      leaveEditor();
    }
  };

  const reloadLatest = async (): Promise<void> => {
    setReloadError(null);
    const refreshed = await digest.refreshWithResult();
    if (!refreshed) {
      setReloadError('The latest version could not be loaded. Your current form was kept.');
      return;
    }
    commands.clearError();
    setDirty(false);
  };

  return (
    <Layout>
      <section
        className="mx-auto flex w-full max-w-5xl flex-col gap-6"
        aria-labelledby="page-title"
      >
        <header className="border-b border-slate-200 pb-5 dark:border-slate-800">
          <button
            type="button"
            onClick={leaveEditor}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-md text-sm font-semibold text-slate-600 hover:text-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-slate-400 dark:hover:text-slate-50"
          >
            <ArrowLeft aria-hidden="true" className="h-4 w-4" />
            Back to digest
          </button>
          <h1
            id="page-title"
            className="mt-3 flex items-center gap-2 text-2xl font-bold text-slate-950 dark:text-slate-50"
          >
            <Newspaper aria-hidden="true" className="h-6 w-6 text-blue-600 dark:text-blue-400" />
            Edit Message Digest
          </h1>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-400">
            Refine what this digest notices and when its next WhatsApp summary should arrive.
          </p>
        </header>

        {commands.hasRevisionConflict ? (
          <div
            role="alert"
            className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100 sm:flex-row sm:items-center sm:justify-between"
          >
            <div>
              <p className="flex items-center gap-2 font-semibold">
                <AlertTriangle aria-hidden="true" className="h-4 w-4" />
                This digest changed elsewhere
              </p>
              <p className="mt-1">
                {commands.error ?? 'Reload the latest version before saving again.'}
              </p>
              {reloadError !== null ? (
                <p className="mt-2 font-medium text-red-800 dark:text-red-200">
                  {reloadError}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              disabled={digest.isRefreshing}
              onClick={(): void => {
                void reloadLatest();
              }}
              className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-amber-400 bg-white px-4 font-semibold text-amber-900 hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-600 disabled:opacity-60 dark:bg-slate-900 dark:text-amber-100"
            >
              <RefreshCw
                aria-hidden="true"
                className={`h-4 w-4 ${digest.isRefreshing ? 'animate-spin motion-reduce:animate-none' : ''}`}
              />
              Reload latest version
            </button>
          </div>
        ) : null}

        <MessageDigestDefinitionForm
          key={`${definition.id}:${String(definition.revision)}`}
          mode="edit"
          initialValue={toFormValue(definition)}
          deliveryReadiness={delivery.readiness}
          deliveryReadinessLoading={delivery.isLoading || delivery.isRefreshing}
          deliveryReadinessError={delivery.error}
          isSubmitting={commands.isUpdating}
          submitError={commands.hasRevisionConflict ? null : commands.error}
          onSubmit={update}
          onCancel={leaveEditor}
          onRefreshDeliveryReadiness={delivery.refresh}
          onDirtyChange={setDirty}
        />
      </section>

      <Modal
        open={unsavedNavigation.isBlocked}
        onOpenChange={(open): void => {
          if (!open) unsavedNavigation.keepEditing();
        }}
        title="Discard unsaved changes?"
        description="Your edits to this Message Digest have not been saved."
        size="sm"
      >
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={unsavedNavigation.keepEditing}
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            Keep editing
          </button>
          <button
            type="button"
            onClick={unsavedNavigation.discardChanges}
            className="inline-flex min-h-11 items-center justify-center rounded-lg bg-red-600 px-4 text-sm font-semibold text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 dark:focus:ring-offset-slate-800"
          >
            Discard changes
          </button>
        </div>
      </Modal>
    </Layout>
  );
}

function toFormValue(definition: MessageDigestDefinition): MessageDigestFormValue {
  return {
    status: definition.status === 'active' ? 'active' : 'paused',
    name: definition.name,
    source: definition.source,
    sourceLocked: definition.sourceLocked,
    instructions: definition.instructions,
    schedule: definition.schedule,
  };
}

function buildUpdatePatch(
  definition: MessageDigestDefinition,
  input: CreateMessageDigestInput
): UpdateMessageDigestCommand['patch'] {
  const patch: UpdateMessageDigestCommand['patch'] = {};
  if (input.name !== definition.name) patch.name = input.name;
  if (input.source.chatId !== definition.source.chatId) patch.source = input.source;
  if (
    input.instructions.templateId !== definition.instructions.templateId ||
    input.instructions.text !== definition.instructions.text
  ) {
    patch.instructions = input.instructions;
  }
  if (!messageDigestSchedulesEqual(input.schedule, definition.schedule)) {
    patch.schedule = input.schedule;
  }
  if (input.status !== definition.status) patch.status = input.status;
  return patch;
}

function messageDigestSchedulesEqual(
  left: MessageDigestSchedule,
  right: MessageDigestSchedule
): boolean {
  if (
    left.kind !== right.kind ||
    left.localTime !== right.localTime ||
    left.timeZone !== right.timeZone
  ) {
    return false;
  }
  return left.kind !== 'weekly' || (right.kind === 'weekly' && left.weekday === right.weekday);
}

function MessageDigestNotFound(): React.JSX.Element {
  return (
    <Layout>
      <section className="mx-auto flex min-h-80 w-full max-w-3xl flex-col items-center justify-center rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <Newspaper aria-hidden="true" className="h-10 w-10 text-slate-400" />
        <h1 className="mt-4 text-2xl font-bold text-slate-950 dark:text-slate-50">
          Message Digest not found
        </h1>
        <p className="mt-2 max-w-lg text-sm leading-6 text-slate-600 dark:text-slate-400">
          This digest does not exist or is not available to this account.
        </p>
        <Link
          to="/whatsapp/message-digests"
          className="mt-5 inline-flex min-h-11 items-center justify-center rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          Back to Message Digests
        </Link>
      </section>
    </Layout>
  );
}

function MessageDigestLoadError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => Promise<void>;
}): React.JSX.Element {
  return (
    <Layout>
      <section className="mx-auto flex min-h-80 w-full max-w-3xl flex-col items-center justify-center rounded-xl border border-red-200 bg-white p-8 text-center shadow-sm dark:border-red-900 dark:bg-slate-900">
        <AlertTriangle aria-hidden="true" className="h-10 w-10 text-red-500" />
        <h1 className="mt-4 text-2xl font-bold text-slate-950 dark:text-slate-50">
          Couldn’t load Message Digest
        </h1>
        <p
          role="alert"
          className="mt-2 max-w-lg text-sm leading-6 text-slate-600 dark:text-slate-400"
        >
          {message}
        </p>
        <button
          type="button"
          onClick={(): void => {
            void onRetry();
          }}
          className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          <RefreshCw aria-hidden="true" className="h-4 w-4" />
          Retry
        </button>
      </section>
    </Layout>
  );
}
