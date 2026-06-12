import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Layout } from '@/components';
import { FishingChatPanel, FishingReferencesPanel } from '@/components/fishing';
import { useFishingChat } from '@/hooks';
import type { FishingChatMessage, SendFishingChatMessageResponse } from '@/types/fishingAssistant';

function latestAssistantMessage(messages: readonly FishingChatMessage[]): FishingChatMessage | null {
  const assistants = messages.filter((message) => message.role === 'assistant');
  return assistants.at(-1) ?? null;
}

export function FishingChatPage(): React.JSX.Element {
  const { chatId } = useParams<{ chatId: string }>();
  const navigate = useNavigate();
  const chat = useFishingChat(chatId);
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);

  useEffect(() => {
    const assistantIds = new Set(
      chat.messages
        .filter((message) => message.role === 'assistant')
        .map((message) => message.id)
    );
    if (selectedMessageId !== null && assistantIds.has(selectedMessageId)) {
      return;
    }
    setSelectedMessageId(latestAssistantMessage(chat.messages)?.id ?? null);
  }, [chat.messages, selectedMessageId]);

  const selectedAssistant = useMemo(() => {
    if (selectedMessageId === null) {
      return latestAssistantMessage(chat.messages);
    }
    return chat.messages.find(
      (message) => message.id === selectedMessageId && message.role === 'assistant'
    ) ?? latestAssistantMessage(chat.messages);
  }, [chat.messages, selectedMessageId]);

  return (
    <Layout>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
          Fishing Assistant Chat
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Persisted conversations grounded in your knowledge base and digest evidence.
        </p>
      </div>

      <div className="grid min-w-0 max-w-full grid-cols-[minmax(0,1fr)] gap-4 2xl:grid-cols-[minmax(0,1fr)_360px]">
        <FishingChatPanel
          chats={chat.chats}
          selectedChatId={chatId}
          messages={chat.messages}
          loading={chat.loading}
          sending={chat.sending}
          error={chat.error}
          errorCode={chat.errorCode}
          selectedMessageId={selectedMessageId}
          onSelectChat={(nextChatId): void => {
            setSelectedMessageId(null);
            void navigate(`/fishing-assistant/chat/${encodeURIComponent(nextChatId)}`);
          }}
          onCreateChat={async (): Promise<void> => {
            const created = await chat.createChat();
            setSelectedMessageId(null);
            void navigate(`/fishing-assistant/chat/${encodeURIComponent(created.id)}`);
          }}
          onSendMessage={async (text): Promise<SendFishingChatMessageResponse | null> => {
            const response = await chat.sendMessage(text);
            if (response !== null && response.chat.id !== chatId) {
              void navigate(`/fishing-assistant/chat/${encodeURIComponent(response.chat.id)}`);
            }
            return response;
          }}
          onSelectMessage={setSelectedMessageId}
        />
        <FishingReferencesPanel
          citations={selectedAssistant?.citations ?? []}
          selectionKey={selectedAssistant?.id ?? null}
        />
      </div>
    </Layout>
  );
}
