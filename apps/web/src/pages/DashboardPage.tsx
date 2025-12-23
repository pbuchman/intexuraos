import { useEffect, useState, useCallback } from 'react';
import { StatusWidget, Layout } from '@/components';
import { useAuth } from '@/context';
import { getNotionStatus, getWhatsAppStatus } from '@/services';
import type { NotionStatus, WhatsAppStatus } from '@/types';

type ConnectionStatus = 'connected' | 'disconnected' | 'error' | 'loading';

interface StatusState {
  status: ConnectionStatus;
  description: string;
  details?: string;
}

export function DashboardPage(): React.JSX.Element {
  const { getAccessToken } = useAuth();
  const [notionState, setNotionState] = useState<StatusState>({
    status: 'loading',
    description: 'Loading...',
  });
  const [whatsappState, setWhatsappState] = useState<StatusState>({
    status: 'loading',
    description: 'Loading...',
  });

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
    } catch {
      setNotionState({ status: 'error', description: 'Authentication error' });
      setWhatsappState({ status: 'error', description: 'Authentication error' });
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

  return (
    <Layout>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-slate-900">Dashboard</h2>
        <p className="text-slate-600">Overview of your integration connections</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {renderNotionWidget()}
        {renderWhatsAppWidget()}
      </div>
    </Layout>
  );
}
