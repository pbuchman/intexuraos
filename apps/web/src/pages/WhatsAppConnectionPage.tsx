import { useEffect, useState, useCallback, type FormEvent } from 'react';
import { Layout, Button, Input, Card } from '@/components';
import { useAuth } from '@/context';
import { getWhatsAppStatus, connectWhatsApp, disconnectWhatsApp, ApiError } from '@/services';
import type { WhatsAppStatus } from '@/types';
import { Plus, X } from 'lucide-react';

interface FormState {
  phoneNumbers: string[];
  inboxNotesDbId: string;
}

export function WhatsAppConnectionPage(): React.JSX.Element {
  const { getAccessToken } = useAuth();
  const [status, setStatus] = useState<WhatsAppStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [form, setForm] = useState<FormState>({
    phoneNumbers: [''],
    inboxNotesDbId: '',
  });

  const fetchStatus = useCallback(async (): Promise<void> => {
    try {
      setIsLoading(true);
      const token = await getAccessToken();
      const whatsappStatus = await getWhatsAppStatus(token);
      setStatus(whatsappStatus);
      if (whatsappStatus) {
        setForm({
          phoneNumbers: whatsappStatus.phoneNumbers.length > 0 ? whatsappStatus.phoneNumbers : [''],
          inboxNotesDbId: whatsappStatus.inboxNotesDbId,
        });
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to fetch status');
    } finally {
      setIsLoading(false);
    }
  }, [getAccessToken]);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  const handleAddPhoneNumber = (): void => {
    setForm((prev) => ({
      ...prev,
      phoneNumbers: [...prev.phoneNumbers, ''],
    }));
  };

  const handleRemovePhoneNumber = (index: number): void => {
    setForm((prev) => ({
      ...prev,
      phoneNumbers: prev.phoneNumbers.filter((_, i) => i !== index),
    }));
  };

  const handlePhoneChange = (index: number, value: string): void => {
    setForm((prev) => ({
      ...prev,
      phoneNumbers: prev.phoneNumbers.map((p, i) => (i === index ? value : p)),
    }));
  };

  const handleSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    const validPhoneNumbers = form.phoneNumbers.map((p) => p.trim()).filter((p) => p.length > 0);

    if (validPhoneNumbers.length === 0) {
      setError('At least one phone number is required');
      return;
    }

    if (!form.inboxNotesDbId.trim()) {
      setError('Inbox Notes Database ID is required');
      return;
    }

    try {
      setIsSaving(true);
      const token = await getAccessToken();
      await connectWhatsApp(token, {
        phoneNumbers: validPhoneNumbers,
        inboxNotesDbId: form.inboxNotesDbId.trim(),
      });
      setSuccessMessage('WhatsApp connection saved successfully');
      await fetchStatus();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to connect WhatsApp');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDisconnect = async (): Promise<void> => {
    setError(null);
    setSuccessMessage(null);

    try {
      setIsDisconnecting(true);
      const token = await getAccessToken();
      await disconnectWhatsApp(token);
      setSuccessMessage('WhatsApp disconnected successfully');
      setForm({ phoneNumbers: [''], inboxNotesDbId: '' });
      setStatus(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to disconnect WhatsApp');
    } finally {
      setIsDisconnecting(false);
    }
  };

  if (isLoading) {
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
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-slate-900">WhatsApp Connection</h2>
        <p className="text-slate-600">
          Connect your WhatsApp phone numbers to forward messages to Notion
        </p>
      </div>

      <div className="max-w-2xl space-y-6">
        {error !== null && error !== '' ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">{error}</div>
        ) : null}

        {successMessage !== null && successMessage !== '' ? (
          <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-green-700">
            {successMessage}
          </div>
        ) : null}

        <Card title="Connection Settings">
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
            <div className="space-y-3">
              <label className="block text-sm font-medium text-slate-700">Phone Numbers</label>
              {form.phoneNumbers.map((phone, index) => (
                <div key={index} className="flex gap-2">
                  <input
                    type="text"
                    placeholder="+48123456789"
                    value={phone}
                    onChange={(e) => {
                      handlePhoneChange(index, e.target.value);
                    }}
                    className="block flex-1 rounded-lg border border-slate-300 px-3 py-2 text-slate-900 shadow-sm transition-colors placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                  {form.phoneNumbers.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => {
                        handleRemovePhoneNumber(index);
                      }}
                      className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-red-600"
                      aria-label="Remove phone number"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  ) : null}
                </div>
              ))}
              <button
                type="button"
                onClick={handleAddPhoneNumber}
                className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700"
              >
                <Plus className="h-4 w-4" />
                Add another phone number
              </button>
            </div>

            <Input
              label="Inbox Notes Database ID"
              placeholder="Enter your Notion database ID"
              value={form.inboxNotesDbId}
              onChange={(e) => {
                setForm((prev) => ({ ...prev, inboxNotesDbId: e.target.value }));
              }}
            />

            <div className="flex gap-3 pt-2">
              <Button type="submit" isLoading={isSaving}>
                {status?.connected === true ? 'Update Connection' : 'Connect WhatsApp'}
              </Button>

              {status?.connected === true ? (
                <Button
                  type="button"
                  variant="danger"
                  isLoading={isDisconnecting}
                  onClick={() => void handleDisconnect()}
                >
                  Disconnect
                </Button>
              ) : null}
            </div>
          </form>
        </Card>

        {status?.connected === true ? (
          <Card title="Current Status" variant="success">
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-600">Status</dt>
                <dd className="font-medium text-green-700">Connected</dd>
              </div>
              <div>
                <dt className="text-slate-600">Connected Phone Numbers</dt>
                <dd className="mt-1 space-y-1">
                  {status.phoneNumbers.map((phone, index) => (
                    <span
                      key={index}
                      className="mr-2 inline-block rounded bg-slate-100 px-2 py-1 font-mono text-sm text-slate-900"
                    >
                      {phone}
                    </span>
                  ))}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-600">Inbox Database ID</dt>
                <dd className="font-mono text-slate-900">{status.inboxNotesDbId}</dd>
              </div>
              {status.updatedAt ? (
                <div className="flex justify-between">
                  <dt className="text-slate-600">Last Updated</dt>
                  <dd className="text-slate-900">{new Date(status.updatedAt).toLocaleString()}</dd>
                </div>
              ) : null}
            </dl>
          </Card>
        ) : null}
      </div>
    </Layout>
  );
}
