import { useEffect, useState, useCallback, type FormEvent } from 'react';
import { Layout, Button, Card } from '@/components';
import { PhoneInput } from '@/components/ui';
import { useAuth } from '@/context';
import { getWhatsAppStatus, connectWhatsApp, disconnectWhatsApp, ApiError } from '@/services';
import type { WhatsAppStatus } from '@/types';
import { Plus, X } from 'lucide-react';

interface PhoneEntry {
  value: string;
  isValid: boolean;
}

interface FormState {
  phoneNumbers: PhoneEntry[];
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
    phoneNumbers: [{ value: '', isValid: false }],
  });

  const fetchStatus = useCallback(async (): Promise<void> => {
    try {
      setIsLoading(true);
      const token = await getAccessToken();
      const whatsappStatus = await getWhatsAppStatus(token);
      setStatus(whatsappStatus);
      if (whatsappStatus) {
        setForm({
          phoneNumbers:
            whatsappStatus.phoneNumbers.length > 0
              ? whatsappStatus.phoneNumbers.map((p) => ({
                  // Add + prefix if not present for display
                  value: p.startsWith('+') ? p : `+${p}`,
                  isValid: true, // Existing numbers are assumed valid
                }))
              : [{ value: '', isValid: false }],
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
      phoneNumbers: [...prev.phoneNumbers, { value: '', isValid: false }],
    }));
  };

  const handleRemovePhoneNumber = (index: number): void => {
    setForm((prev) => ({
      ...prev,
      phoneNumbers: prev.phoneNumbers.filter((_, i) => i !== index),
    }));
  };

  const handlePhoneChange = (index: number, value: string, isValid: boolean): void => {
    setForm((prev) => ({
      ...prev,
      phoneNumbers: prev.phoneNumbers.map((p, i) => (i === index ? { value, isValid } : p)),
    }));
  };

  const handleSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    // Filter to non-empty phone numbers
    const nonEmptyPhones = form.phoneNumbers.filter((p) => p.value.trim().length > 0);

    if (nonEmptyPhones.length === 0) {
      setError('At least one phone number is required');
      return;
    }

    // Check all non-empty numbers are valid
    const invalidPhones = nonEmptyPhones.filter((p) => !p.isValid);
    if (invalidPhones.length > 0) {
      setError('Please fix invalid phone numbers before saving');
      return;
    }

    // Extract values for API
    const validPhoneNumbers = nonEmptyPhones.map((p) => p.value);

    try {
      setIsSaving(true);
      const token = await getAccessToken();
      await connectWhatsApp(token, {
        phoneNumbers: validPhoneNumbers,
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
      setForm({ phoneNumbers: [{ value: '', isValid: false }] });
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
          Connect your WhatsApp phone numbers to save messages as notes
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
              <p className="text-sm text-slate-500">
                Select your country and enter your phone number. Currently supports Poland and USA.
              </p>
              {form.phoneNumbers.map((phone, index) => (
                <div key={index} className="flex gap-2">
                  <PhoneInput
                    value={phone.value}
                    onChange={(value, isValid) => {
                      handlePhoneChange(index, value, isValid);
                    }}
                    className="flex-1"
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
                      +{phone.replace(/^\+/, '')}
                    </span>
                  ))}
                </dd>
              </div>
              {status.updatedAt !== '' ? (
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
