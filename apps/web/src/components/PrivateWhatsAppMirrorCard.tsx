import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/context';
import {
  ApiError,
  disablePrivateWhatsAppAccount,
  getPrivateWhatsAppAccount,
  upsertPrivateWhatsAppAccount,
} from '@/services';
import type { PrivateWhatsAppAccount, WhatsAppStatus } from '@/types';
import { Button, Card } from './ui';

const PRIVATE_EVENTS_URL = 'https://intexuraos.cloud/internal/whatsapp/private/events';
const OIDC_AUDIENCE = 'https://intexuraos.cloud';

interface PrivateWhatsAppMirrorCardProps {
  status: WhatsAppStatus | null;
}

function formatPhone(phoneNumber: string): string {
  return phoneNumber.startsWith('+') ? phoneNumber : `+${phoneNumber}`;
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

export function PrivateWhatsAppMirrorCard({
  status,
}: PrivateWhatsAppMirrorCardProps): React.JSX.Element {
  const { getAccessToken } = useAuth();
  const [account, setAccount] = useState<PrivateWhatsAppAccount | null>(null);
  const [selectedPhone, setSelectedPhone] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connectedPhones = useMemo(
    () => (status?.connected === true ? status.phoneNumbers.map(formatPhone) : []),
    [status]
  );

  const loadAccount = useCallback(async (): Promise<void> => {
    try {
      setIsLoading(true);
      setError(null);
      const token = await getAccessToken();
      setAccount(await getPrivateWhatsAppAccount(token));
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load private WhatsApp mirror'));
    } finally {
      setIsLoading(false);
    }
  }, [getAccessToken]);

  useEffect(() => {
    void loadAccount();
  }, [loadAccount]);

  useEffect(() => {
    if (connectedPhones.length > 0 && selectedPhone === '') {
      setSelectedPhone(connectedPhones[0] ?? '');
    }
  }, [connectedPhones, selectedPhone]);

  const handleEnable = async (): Promise<void> => {
    if (selectedPhone === '') {
      return;
    }
    try {
      setIsSaving(true);
      setError(null);
      const token = await getAccessToken();
      const nextAccount = await upsertPrivateWhatsAppAccount(token, {
        phoneNumber: selectedPhone,
      });
      setAccount(nextAccount);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to enable private WhatsApp mirror'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDisable = async (): Promise<void> => {
    try {
      setIsSaving(true);
      setError(null);
      const token = await getAccessToken();
      const nextAccount = await disablePrivateWhatsAppAccount(token);
      setAccount(nextAccount);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to disable private WhatsApp mirror'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card title="Private WhatsApp Mirror">
      {error !== null && error !== '' ? (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
          {error}
        </div>
      ) : null}

      {isLoading ? (
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
      ) : account?.status === 'active' ? (
        <div className="space-y-4">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-slate-600 dark:text-slate-400">Status</dt>
              <dd className="font-medium text-green-700 dark:text-green-400">Active</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-600 dark:text-slate-400">Phone</dt>
              <dd className="font-mono text-slate-900 dark:text-slate-100">
                +{account.phoneNumberNormalized}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-600 dark:text-slate-400">Source account</dt>
              <dd className="break-all font-mono text-slate-900 dark:text-slate-100">
                {account.sourceAccountId}
              </dd>
            </div>
            {account.lastEventAt !== undefined ? (
              <div className="flex justify-between gap-4">
                <dt className="text-slate-600 dark:text-slate-400">Last event</dt>
                <dd className="text-slate-900 dark:text-slate-100">
                  {new Date(account.lastEventAt).toLocaleString()}
                </dd>
              </div>
            ) : null}
          </dl>

          <div className="space-y-2 rounded-lg bg-slate-50 p-3 text-xs dark:bg-slate-900/60">
            <div className="flex flex-col gap-1">
              <span className="font-medium text-slate-600 dark:text-slate-400">Events URL</span>
              <code className="break-all text-slate-900 dark:text-slate-100">
                {PRIVATE_EVENTS_URL}
              </code>
            </div>
            <div className="flex flex-col gap-1">
              <span className="font-medium text-slate-600 dark:text-slate-400">OIDC audience</span>
              <code className="break-all text-slate-900 dark:text-slate-100">
                {OIDC_AUDIENCE}
              </code>
            </div>
            <div className="flex flex-col gap-1">
              <span className="font-medium text-slate-600 dark:text-slate-400">
                Source account
              </span>
              <code className="break-all text-slate-900 dark:text-slate-100">
                {account.sourceAccountId}
              </code>
            </div>
          </div>

          <Button
            type="button"
            variant="danger"
            size="sm"
            isLoading={isSaving}
            onClick={() => void handleDisable()}
          >
            Disable private mirror
          </Button>
        </div>
      ) : connectedPhones.length === 0 ? (
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Verify an assistant WhatsApp phone first.
        </p>
      ) : (
        <div className="space-y-4">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            Mirror phone
          </label>
          <select
            value={selectedPhone}
            onChange={(event) => {
              setSelectedPhone(event.target.value);
            }}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          >
            {connectedPhones.map((phone) => (
              <option key={phone} value={phone}>
                {phone}
              </option>
            ))}
          </select>
          <Button
            type="button"
            size="sm"
            isLoading={isSaving}
            disabled={selectedPhone === ''}
            onClick={() => void handleEnable()}
          >
            Enable private mirror
          </Button>
        </div>
      )}
    </Card>
  );
}
