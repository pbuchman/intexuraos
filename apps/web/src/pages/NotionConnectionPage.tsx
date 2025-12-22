import { useEffect, useState, useCallback, type FormEvent } from 'react';
import { Layout, Button, Input, Card } from '@/components';
import { useAuth } from '@/context';
import { getNotionStatus, connectNotion, disconnectNotion, ApiError } from '@/services';
import type { NotionStatus } from '@/types';

interface FormState {
  notionToken: string;
  promptVaultPageId: string;
}

export function NotionConnectionPage(): React.JSX.Element {
  const { getAccessToken } = useAuth();
  const [status, setStatus] = useState<NotionStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [form, setForm] = useState<FormState>({
    notionToken: '',
    promptVaultPageId: '',
  });

  const fetchStatus = useCallback(async (): Promise<void> => {
    try {
      setIsLoading(true);
      const token = await getAccessToken();
      const notionStatus = await getNotionStatus(token);
      setStatus(notionStatus);
      if (notionStatus.promptVaultPageId !== null && notionStatus.promptVaultPageId !== '') {
        setForm((prev) => ({
          ...prev,
          promptVaultPageId: notionStatus.promptVaultPageId ?? '',
        }));
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

  const handleSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    if (!form.notionToken.trim() || !form.promptVaultPageId.trim()) {
      setError('Both fields are required');
      return;
    }

    try {
      setIsSaving(true);
      const token = await getAccessToken();
      await connectNotion(token, {
        notionToken: form.notionToken.trim(),
        promptVaultPageId: form.promptVaultPageId.trim(),
      });
      setSuccessMessage('Notion connection saved successfully');
      setForm((prev) => ({ ...prev, notionToken: '' }));
      await fetchStatus();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to connect Notion');
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
      await disconnectNotion(token);
      setSuccessMessage('Notion disconnected successfully');
      setForm({ notionToken: '', promptVaultPageId: '' });
      await fetchStatus();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to disconnect Notion');
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
        <h2 className="text-2xl font-bold text-slate-900">Notion Connection</h2>
        <p className="text-slate-600">Connect your Notion workspace to sync prompts and notes</p>
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
            <Input
              label="PromptVault Page ID"
              placeholder="Enter your Notion page ID"
              value={form.promptVaultPageId}
              onChange={(e) => {
                setForm((prev) => ({ ...prev, promptVaultPageId: e.target.value }));
              }}
            />

            <Input
              label="Notion Integration Token"
              type="password"
              placeholder="secret_..."
              value={form.notionToken}
              onChange={(e) => {
                setForm((prev) => ({ ...prev, notionToken: e.target.value }));
              }}
            />

            <div className="flex gap-3 pt-2">
              <Button type="submit" isLoading={isSaving}>
                {status?.connected === true ? 'Update Connection' : 'Connect Notion'}
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
              <div className="flex justify-between">
                <dt className="text-slate-600">Page ID</dt>
                <dd className="font-mono text-slate-900">{status.promptVaultPageId}</dd>
              </div>
              {status.updatedAt !== null ? (
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
