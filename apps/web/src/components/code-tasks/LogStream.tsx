import { CodeTaskLogViewer } from './CodeTaskLogViewer.js';
import type { MessageStatus } from '@/hooks';
import type { LogLine } from '@/hooks/useCodeTaskLogs.js';
import type { CodeTaskStatus } from '@/types';

interface LogStreamProps {
  logs: LogLine[];
  isActive: boolean;
  listenerHealthy: boolean;
  taskStatus: CodeTaskStatus;
  agentType?: string;
  onSendMessage: (message: string) => Promise<void>;
  sending: boolean;
  sendError: { code: string; message: string } | null;
  messageStatus: MessageStatus;
  workerOnline: boolean;
  workerName: string;
}

export function LogStream(props: LogStreamProps): React.JSX.Element {
  return <CodeTaskLogViewer {...props} />;
}
