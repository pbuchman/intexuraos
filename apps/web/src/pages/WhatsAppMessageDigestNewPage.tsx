import { ArrowLeft, Newspaper } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { MessageDigestDefinitionForm } from '@/components/message-digests/MessageDigestDefinitionForm';
import { Modal } from '@/components/ui/Modal';
import {
  useMessageDigestCommands,
  useMessageDigestDeliveryReadiness,
} from '@/hooks/useMessageDigests';
import { useUnsavedMessageDigestNavigation } from '@/hooks/useUnsavedMessageDigestNavigation';
import type { CreateMessageDigestInput } from '@/types/messageDigests';

export function WhatsAppMessageDigestNewPage(): React.JSX.Element {
  const navigate = useNavigate();
  const commands = useMessageDigestCommands();
  const delivery = useMessageDigestDeliveryReadiness();
  const [dirty, setDirty] = useState(false);
  const unsavedNavigation = useUnsavedMessageDigestNavigation(dirty);

  const leaveEditor = useCallback((): void => {
    void navigate('/whatsapp/message-digests');
  }, [navigate]);

  const create = async (input: CreateMessageDigestInput): Promise<void> => {
    const response = await commands.createDigest(input);
    if (response === null) return;
    unsavedNavigation.disarm();
    void navigate(`/whatsapp/message-digests/${response.definition.id}`, {
      replace: true,
      state: {
        created: true,
        disposition: response.disposition,
        activationAdjusted: response.activationAdjusted,
      },
    });
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
            Back to Message Digests
          </button>
          <h1
            id="page-title"
            className="mt-3 flex items-center gap-2 text-2xl font-bold text-slate-950 dark:text-slate-50"
          >
            <Newspaper aria-hidden="true" className="h-6 w-6 text-blue-600 dark:text-blue-400" />
            New Message Digest
          </h1>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-400">
            Turn one mirrored WhatsApp conversation into a focused daily summary delivered to your
            primary WhatsApp number.
          </p>
        </header>

        <MessageDigestDefinitionForm
          mode="create"
          deliveryReadiness={delivery.readiness}
          deliveryReadinessLoading={delivery.isLoading || delivery.isRefreshing}
          deliveryReadinessError={delivery.error}
          isSubmitting={commands.isCreating}
          submitError={commands.error}
          onSubmit={create}
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
        description="Your Message Digest setup has not been saved."
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
