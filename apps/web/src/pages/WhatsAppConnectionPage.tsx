import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Button, Card, Layout } from '@/components';
import { PhoneInput } from '@/components/ui';
import { useAuth } from '@/context';
import {
  ApiError,
  confirmVerificationCode,
  connectWhatsApp,
  disconnectWhatsApp,
  getVerificationStatus,
  getWhatsAppStatus,
  sendVerificationCode,
} from '@/services';
import type { WhatsAppStatus } from '@/types';
import { Plus, X, Check, Send } from 'lucide-react';

type VerificationState = 'unverified' | 'sending' | 'pending' | 'confirming' | 'verified';

interface PhoneEntry {
  value: string;
  isValid: boolean;
  verificationState: VerificationState;
  verificationId?: string | undefined;
  otpCode: string;
  error?: string | undefined;
}

interface FormState {
  phoneNumbers: PhoneEntry[];
}

function createEmptyPhoneEntry(): PhoneEntry {
  return {
    value: '',
    isValid: false,
    verificationState: 'unverified',
    otpCode: '',
  };
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
    phoneNumbers: [createEmptyPhoneEntry()],
  });

  const fetchStatus = useCallback(async (): Promise<void> => {
    try {
      setIsLoading(true);
      const token = await getAccessToken();
      const whatsappStatus = await getWhatsAppStatus(token);
      setStatus(whatsappStatus);
      if (whatsappStatus) {
        const phoneEntries: PhoneEntry[] = await Promise.all(
          whatsappStatus.phoneNumbers.map(async (p) => {
            const phoneValue = p.startsWith('+') ? p : `+${p}`;
            let verificationState: VerificationState = 'unverified';
            try {
              const verifyStatus = await getVerificationStatus(token, phoneValue);
              if (verifyStatus.verified) {
                verificationState = 'verified';
              }
            } catch {
              // Ignore - will show as unverified
            }
            return {
              value: phoneValue,
              isValid: true,
              verificationState,
              otpCode: '',
            };
          })
        );
        setForm({
          phoneNumbers: phoneEntries.length > 0 ? phoneEntries : [createEmptyPhoneEntry()],
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
      phoneNumbers: [...prev.phoneNumbers, createEmptyPhoneEntry()],
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
      phoneNumbers: prev.phoneNumbers.map((p, i) =>
        i === index
          ? { value, isValid, verificationState: 'unverified' as const, verificationId: undefined, otpCode: '', error: undefined }
          : p
      ),
    }));
  };

  const handleOtpChange = (index: number, otpCode: string): void => {
    setForm((prev) => ({
      ...prev,
      phoneNumbers: prev.phoneNumbers.map((p, i) => (i === index ? { ...p, otpCode } : p)),
    }));
  };

  const handleSendCode = async (index: number): Promise<void> => {
    const phone = form.phoneNumbers[index];
    if (!phone?.isValid) return;

    setForm((prev) => ({
      ...prev,
      phoneNumbers: prev.phoneNumbers.map((p, i) =>
        i === index ? { ...p, verificationState: 'sending', error: undefined } : p
      ),
    }));

    try {
      const token = await getAccessToken();
      const response = await sendVerificationCode(token, { phoneNumber: phone.value });
      setForm((prev) => ({
        ...prev,
        phoneNumbers: prev.phoneNumbers.map((p, i) =>
          i === index
            ? { ...p, verificationState: 'pending', verificationId: response.verificationId }
            : p
        ),
      }));
    } catch (e) {
      const errorMessage = e instanceof ApiError ? e.message : 'Failed to send code';
      setForm((prev) => ({
        ...prev,
        phoneNumbers: prev.phoneNumbers.map((p, i) =>
          i === index ? { ...p, verificationState: 'unverified', error: errorMessage } : p
        ),
      }));
    }
  };

  const handleConfirmCode = async (index: number): Promise<void> => {
    const phone = form.phoneNumbers[index];
    if (!phone?.verificationId || phone.otpCode.length !== 6) return;

    setForm((prev) => ({
      ...prev,
      phoneNumbers: prev.phoneNumbers.map((p, i) =>
        i === index ? { ...p, verificationState: 'confirming', error: undefined } : p
      ),
    }));

    try {
      const token = await getAccessToken();
      await confirmVerificationCode(token, {
        verificationId: phone.verificationId,
        code: phone.otpCode,
      });
      setForm((prev) => ({
        ...prev,
        phoneNumbers: prev.phoneNumbers.map((p, i) =>
          i === index ? { ...p, verificationState: 'verified' } : p
        ),
      }));
    } catch (e) {
      const errorMessage = e instanceof ApiError ? e.message : 'Failed to verify code';
      setForm((prev) => ({
        ...prev,
        phoneNumbers: prev.phoneNumbers.map((p, i) =>
          i === index ? { ...p, verificationState: 'pending', error: errorMessage } : p
        ),
      }));
    }
  };

  const allPhonesVerified = form.phoneNumbers
    .filter((p) => p.value.trim().length > 0)
    .every((p) => p.verificationState === 'verified');

  const hasValidPhones = form.phoneNumbers.some((p) => p.value.trim().length > 0 && p.isValid);

  const handleSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    const nonEmptyPhones = form.phoneNumbers.filter((p) => p.value.trim().length > 0);

    if (nonEmptyPhones.length === 0) {
      setError('At least one phone number is required');
      return;
    }

    const invalidPhones = nonEmptyPhones.filter((p) => !p.isValid);
    if (invalidPhones.length > 0) {
      setError('Please fix invalid phone numbers before saving');
      return;
    }

    const unverifiedPhones = nonEmptyPhones.filter((p) => p.verificationState !== 'verified');
    if (unverifiedPhones.length > 0) {
      setError('All phone numbers must be verified before connecting');
      return;
    }

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
      setForm({ phoneNumbers: [createEmptyPhoneEntry()] });
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
                Enter your phone number and verify it with a 6-digit code sent via WhatsApp.
              </p>
              {form.phoneNumbers.map((phone, index) => (
                <div key={index} className="space-y-2">
                  <div className="flex gap-2">
                    <PhoneInput
                      value={phone.value}
                      onChange={(value, isValid) => {
                        handlePhoneChange(index, value, isValid);
                      }}
                      className="flex-1"
                      disabled={phone.verificationState === 'verified'}
                    />
                    {phone.verificationState === 'verified' ? (
                      <div className="flex items-center gap-1 rounded-lg bg-green-100 px-3 text-green-700">
                        <Check className="h-4 w-4" />
                        <span className="text-sm font-medium">Verified</span>
                      </div>
                    ) : phone.verificationState === 'pending' || phone.verificationState === 'confirming' ? (
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={phone.otpCode}
                          onChange={(e) => {
                            handleOtpChange(index, e.target.value.replace(/\D/g, '').slice(0, 6));
                          }}
                          placeholder="6-digit code"
                          className="w-28 rounded-lg border border-slate-300 px-3 py-2 text-center font-mono text-lg tracking-widest focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                          maxLength={6}
                        />
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => void handleConfirmCode(index)}
                          disabled={phone.otpCode.length !== 6 || phone.verificationState === 'confirming'}
                          isLoading={phone.verificationState === 'confirming'}
                        >
                          Verify
                        </Button>
                      </div>
                    ) : (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => void handleSendCode(index)}
                        disabled={!phone.isValid || phone.verificationState === 'sending'}
                        isLoading={phone.verificationState === 'sending'}
                      >
                        <Send className="mr-1 h-4 w-4" />
                        Send Code
                      </Button>
                    )}
                    {form.phoneNumbers.length > 1 && phone.verificationState !== 'verified' ? (
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
                  {phone.error !== undefined && phone.error !== '' ? (
                    <p className="text-sm text-red-600">{phone.error}</p>
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
              <Button
                type="submit"
                isLoading={isSaving}
                disabled={!allPhonesVerified || !hasValidPhones}
              >
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

            {hasValidPhones && !allPhonesVerified ? (
              <p className="text-sm text-amber-600">
                Please verify all phone numbers before connecting.
              </p>
            ) : null}
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
