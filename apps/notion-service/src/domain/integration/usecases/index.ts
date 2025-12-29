/**
 * Domain use-cases for notion-service integration.
 */
export {
  connectNotion,
  createConnectNotionUseCase,
  type ConnectNotionInput,
  type ConnectNotionResult,
  type ConnectNotionError,
  type ConnectNotionErrorCode,
} from './connectNotion.js';

export {
  getNotionStatus,
  createGetNotionStatusUseCase,
  type GetNotionStatusInput,
  type NotionStatus,
  type GetNotionStatusError,
} from './getNotionStatus.js';

export {
  disconnectNotion,
  createDisconnectNotionUseCase,
  type DisconnectNotionInput,
  type DisconnectNotionResult,
  type DisconnectNotionError,
} from './disconnectNotion.js';
