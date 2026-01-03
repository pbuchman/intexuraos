import { useCallback, useEffect, useState } from 'react';
import { Layout, StatusWidget } from '@/components';
import { useAuth } from '@/context';
import { useLlmKeys } from '@/hooks';
import {
  getMobileNotificationsStatus,
  getNotionStatus,
  getWhatsAppStatus,
  getLlmUsageStats,
  type LlmUsageStats,
  type MobileNotificationsStatusResponse,
} from '@/services';
import type { NotionStatus, WhatsAppStatus } from '@/types';

type ConnectionStatus = 'connected' | 'disconnected' | 'error' | 'loading';

interface StatusState {
  status: ConnectionStatus;
  description: string;
  details?: string;
}

export function SystemHealthPage(): React.JSX.Element {
  const { getAccessToken } = useAuth();
  const { keys: llmKeys, loading: llmLoading } = useLlmKeys();
  const [notionState, setNotionState] = useState<StatusState>({
    status: 'loading',
    description: 'Loading...',
  });
  const [whatsappState, setWhatsappState] = useState<StatusState>({
    status: 'loading',
    description: 'Loading...',
  });
  const [mobileNotificationsState, setMobileNotificationsState] = useState<StatusState>({
    status: 'loading',
    description: 'Loading...',
  });
  const [usageStats, setUsageStats] = useState<LlmUsageStats[]>([]);
  const [usageStatsLoading, setUsageStatsLoading] = useState(true);

  const fetchStatuses = useCallback(async (): Promise<void> => {
    try {
      const token = await getAccessToken();

      // Fetch Notion status
      try {
        const notionStatus: NotionStatus = await getNotionStatus(token);
        const newState: StatusState = {
          status: notionStatus.connected ? 'connected' : 'disconnected',
          description: notionStatus.connected
            ? `Connected to page: ${notionStatus.promptVaultPageId ?? 'Unknown'}`
            : 'Connect your Notion workspace',
        };
        if (notionStatus.updatedAt !== null) {
          newState.details = `Last updated: ${new Date(notionStatus.updatedAt).toLocaleDateString()}`;
        }
        setNotionState(newState);
      } catch {
        setNotionState({
          status: 'error',
          description: 'Failed to fetch Notion status',
        });
      }

      // Fetch WhatsApp status
      try {
        const whatsappStatus: WhatsAppStatus | null = await getWhatsAppStatus(token);
        if (whatsappStatus?.connected === true) {
          const newState: StatusState = {
            status: 'connected',
            description: `${String(whatsappStatus.phoneNumbers.length)} phone number(s) connected`,
          };
          if (whatsappStatus.updatedAt !== '') {
            newState.details = `Last updated: ${new Date(whatsappStatus.updatedAt).toLocaleDateString()}`;
          }
          setWhatsappState(newState);
        } else {
          setWhatsappState({
            status: 'disconnected',
            description: 'Connect your WhatsApp numbers',
          });
        }
      } catch {
        setWhatsappState({
          status: 'error',
          description: 'Failed to fetch WhatsApp status',
        });
      }

      // Fetch Mobile Notifications status
      try {
        const mobileStatus: MobileNotificationsStatusResponse =
          await getMobileNotificationsStatus(token);
        if (mobileStatus.configured) {
          const newState: StatusState = {
            status: 'connected',
            description: 'Device configured',
          };
          if (mobileStatus.lastNotificationAt !== null) {
            newState.details = `Last notification: ${new Date(mobileStatus.lastNotificationAt).toLocaleString()}`;
          }
          setMobileNotificationsState(newState);
        } else {
          setMobileNotificationsState({
            status: 'disconnected',
            description: 'Configure your mobile device',
          });
        }
      } catch {
        setMobileNotificationsState({
          status: 'error',
          description: 'Failed to fetch status',
        });
      }

      // Fetch LLM usage stats
      try {
        const stats = await getLlmUsageStats(token);
        setUsageStats(stats);
      } catch {
        // Silently fail - usage stats are optional
      } finally {
        setUsageStatsLoading(false);
      }
    } catch {
      setNotionState({ status: 'error', description: 'Authentication error' });
      setWhatsappState({ status: 'error', description: 'Authentication error' });
      setMobileNotificationsState({ status: 'error', description: 'Authentication error' });
    }
  }, [getAccessToken]);

  useEffect(() => {
    void fetchStatuses();
  }, [fetchStatuses]);

  const renderNotionWidget = (): React.JSX.Element => {
    const details = notionState.details;
    if (details !== undefined) {
      return (
        <StatusWidget
          title="Notion Integration"
          status={notionState.status}
          description={notionState.description}
          details={details}
        />
      );
    }
    return (
      <StatusWidget
        title="Notion Integration"
        status={notionState.status}
        description={notionState.description}
      />
    );
  };

  const renderWhatsAppWidget = (): React.JSX.Element => {
    const details = whatsappState.details;
    if (details !== undefined) {
      return (
        <StatusWidget
          title="WhatsApp Integration"
          status={whatsappState.status}
          description={whatsappState.description}
          details={details}
        />
      );
    }
    return (
      <StatusWidget
        title="WhatsApp Integration"
        status={whatsappState.status}
        description={whatsappState.description}
      />
    );
  };

  const renderMobileNotificationsWidget = (): React.JSX.Element => {
    const details = mobileNotificationsState.details;
    if (details !== undefined) {
      return (
        <StatusWidget
          title="Mobile Notifications"
          status={mobileNotificationsState.status}
          description={mobileNotificationsState.description}
          details={details}
        />
      );
    }
    return (
      <StatusWidget
        title="Mobile Notifications"
        status={mobileNotificationsState.status}
        description={mobileNotificationsState.description}
      />
    );
  };

  const getLlmStatus = (provider: 'google' | 'openai' | 'anthropic'): StatusState => {
    if (llmLoading) {
      return { status: 'loading', description: 'Loading...' };
    }
    if (llmKeys === null) {
      return { status: 'disconnected', description: 'Configure API key' };
    }

    const hasKey = llmKeys[provider] !== null;
    const testResult = llmKeys.testResults[provider];

    if (!hasKey) {
      return { status: 'disconnected', description: 'API key not configured' };
    }

    if (testResult !== null) {
      return {
        status: 'connected',
        description: 'API key configured and tested',
        details: `Last tested: ${new Date(testResult.testedAt).toLocaleString()}`,
      };
    }

    return { status: 'disconnected', description: 'API key configured (not tested)' };
  };

  const renderLlmWidget = (
    title: string,
    provider: 'google' | 'openai' | 'anthropic'
  ): React.JSX.Element => {
    const state = getLlmStatus(provider);
    const details = state.details;
    if (details !== undefined) {
      return (
        <StatusWidget
          title={title}
          status={state.status}
          description={state.description}
          details={details}
        />
      );
    }
    return <StatusWidget title={title} status={state.status} description={state.description} />;
  };

  return (
    <Layout>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-slate-900">System Health</h2>
        <p className="text-slate-600">Overview of your integration connections</p>
      </div>

      <div className="mb-8">
        <h3 className="text-lg font-semibold text-slate-800 mb-4">Integrations</h3>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {renderNotionWidget()}
          {renderWhatsAppWidget()}
          {renderMobileNotificationsWidget()}
        </div>
      </div>

      <div className="mb-8">
        <h3 className="text-lg font-semibold text-slate-800 mb-4">LLM Providers</h3>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {renderLlmWidget('Claude (Anthropic)', 'anthropic')}
          {renderLlmWidget('Gemini (Google)', 'google')}
          {renderLlmWidget('GPT (OpenAI)', 'openai')}
        </div>
      </div>

      <div>
        <h3 className="text-lg font-semibold text-slate-800 mb-4">LLM Usage Statistics</h3>
        {usageStatsLoading ? (
          <p className="text-slate-500">Loading usage statistics...</p>
        ) : usageStats.length === 0 ? (
          <p className="text-slate-500">No usage data available yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                    Model
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">
                    Calls
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">
                    Success Rate
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">
                    Total Tokens
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">
                    Cost (USD)
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-200">
                {usageStats.map((stat) => (
                  <tr key={`${stat.provider}_${stat.model}`}>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-slate-900">
                      <span className="font-medium">{stat.model}</span>
                      <span className="text-slate-500 ml-2">({stat.provider})</span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-slate-600">
                      {stat.calls.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-slate-600">
                      {stat.calls > 0
                        ? `${((stat.successfulCalls / stat.calls) * 100).toFixed(1)}%`
                        : '-'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-slate-600">
                      {stat.totalTokens.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-slate-600">
                      ${stat.costUsd.toFixed(4)}
                    </td>
                  </tr>
                ))}
                <tr className="bg-slate-50 font-medium">
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-slate-900">Total</td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-slate-900">
                    {usageStats.reduce((sum, s) => sum + s.calls, 0).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-slate-900">
                    {((): string => {
                      const totalCalls = usageStats.reduce((sum, s) => sum + s.calls, 0);
                      const successCalls = usageStats.reduce(
                        (sum, s) => sum + s.successfulCalls,
                        0
                      );
                      return totalCalls > 0
                        ? `${((successCalls / totalCalls) * 100).toFixed(1)}%`
                        : '-';
                    })()}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-slate-900">
                    {usageStats.reduce((sum, s) => sum + s.totalTokens, 0).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-slate-900">
                    ${usageStats.reduce((sum, s) => sum + s.costUsd, 0).toFixed(4)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Layout>
  );
}
