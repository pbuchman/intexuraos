import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Button, Card, Input, Layout } from '@/components';
import { useAuth } from '@/context';
import {
  ApiError,
  connectNotion,
  disconnectNotion,
  getNotionStatus,
  getResearchNotionSettings,
  saveResearchNotionSettings,
} from '@/services';
import type { NotionStatus } from '@/types';

interface FormState {
  notionToken: string;
  promptVaultPageId: string;
  researchPageId: string;
}

export function NotionConnectionPage(): React.JSX.Element {
  const { getAccessToken } = useAuth();
  const [status, setStatus] = useState<NotionStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [isSavingResearch, setIsSavingResearch] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [researchSettingsLoaded, setResearchSettingsLoaded] = useState(false);

  const [form, setForm] = useState<FormState>({
    notionToken: '',
    promptVaultPageId: '',
    researchPageId: '',
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

      // Fetch research settings if Notion is connected
      if (notionStatus.connected) {
        try {
          const researchSettings = await getResearchNotionSettings(token);
          setForm((prev) => ({
            ...prev,
            researchPageId: researchSettings.researchPageId ?? '',
          }));
          setResearchSettingsLoaded(true);
        } catch {
          // If research settings fail, continue without them
          setResearchSettingsLoaded(true);
        }
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
      setForm({ notionToken: '', promptVaultPageId: '', researchPageId: '' });
      setResearchSettingsLoaded(false);
      await fetchStatus();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to disconnect Notion');
    } finally {
      setIsDisconnecting(false);
    }
  };

  const handleSaveResearchSettings = async (): Promise<void> => {
    setError(null);
    setSuccessMessage(null);

    if (!form.researchPageId.trim()) {
      setError('Research Page ID cannot be empty');
      return;
    }

    try {
      setIsSavingResearch(true);
      const token = await getAccessToken();
      await saveResearchNotionSettings(token, form.researchPageId.trim());
      setSuccessMessage('Research export settings saved');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to save research settings');
    } finally {
      setIsSavingResearch(false);
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
        <p className="text-slate-600">Connect your Notion workspace to sync prompts and research</p>
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
          <Card title="Research Export Settings">
            <div className="space-y-4">
              <p className="text-sm text-slate-500">
                Configure a separate Notion page for completed research syntheses to be automatically
                exported.
              </p>

              <Input
                label="Research Export Page ID"
                placeholder="Enter your Notion page ID for research exports"
                value={form.researchPageId}
                onChange={(e) => {
                  setForm((prev) => ({ ...prev, researchPageId: e.target.value }));
                }}
              />

              <div className="flex gap-3 pt-2">
                <Button
                  type="button"
                  isLoading={isSavingResearch}
                  onClick={() => void handleSaveResearchSettings()}
                >
                  Save Research Settings
                </Button>
              </div>

              {researchSettingsLoaded && form.researchPageId ? (
                <div className="mt-4 rounded-md border border-green-200 bg-green-50 p-3">
                  <p className="text-sm text-green-700">
                    <span className="font-medium">Configured:</span> Research exports will be sent
                    to page{' '}
                    <span className="font-mono">{form.researchPageId}</span>
                  </p>
                </div>
              ) : null}
            </div>
          </Card>
        ) : null}

        {status?.connected === true ? (
          <Card title="Current Status" variant="success">
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-600">Status</dt>
                <dd className="font-medium text-green-700">Connected</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-600">PromptVault Page ID</dt>
                <dd className="font-mono text-slate-900">{status.promptVaultPageId}</dd>
              </div>
              {form.researchPageId ? (
                <div className="flex justify-between">
                  <dt className="text-slate-600">Research Page ID</dt>
                  <dd className="font-mono text-slate-900">{form.researchPageId}</dd>
                </div>
              ) : null}
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
