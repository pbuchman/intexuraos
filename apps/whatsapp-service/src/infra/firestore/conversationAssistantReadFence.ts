import { getFirestore } from '@intexuraos/infra-firestore';
import {
  PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION,
  PRIVATE_WHATSAPP_CHATS_COLLECTION,
} from './privateWhatsAppRepository.js';

type FirestoreClient = ReturnType<typeof getFirestore>;

interface ConversationAssistantReadFenceInput {
  db: FirestoreClient;
  sessionData: Record<string, unknown> | undefined;
  expectedUserId?: string;
  requireSourceAccountGeneration?: boolean;
  transaction?: FirebaseFirestore.Transaction;
}

interface ConversationAssistantReadFenceWithAccountInput
  extends ConversationAssistantReadFenceInput {
  accountData: Record<string, unknown> | undefined;
}

/**
 * Public Conversation Assistant data remains readable for an ordinary disabled account, but is
 * hidden as soon as erasure starts or the source account identity/generation is no longer exact.
 */
export async function conversationAssistantSessionReadFenceAllows(
  input: ConversationAssistantReadFenceInput
): Promise<boolean> {
  const userId = readNonEmptyString(input.sessionData?.['userId']);
  if (userId === null) return false;
  const accountSnapshot = await readDocument(
    input.db.collection(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION).doc(userId),
    input.transaction
  );
  return await conversationAssistantSessionReadFenceAllowsWithAccount({
    ...input,
    accountData: accountSnapshot.exists ? accountSnapshot.data() : undefined,
  });
}

export async function conversationAssistantSessionReadFenceAllowsWithAccount(
  input: ConversationAssistantReadFenceWithAccountInput
): Promise<boolean> {
  const session = input.sessionData;
  const userId = readNonEmptyString(session?.['userId']);
  if (
    userId === null ||
    (input.expectedUserId !== undefined && userId !== input.expectedUserId) ||
    typeof session?.['deletionStartedAt'] === 'string'
  ) {
    return false;
  }

  const account = input.accountData;
  const accountSourceAccountId = readNonEmptyString(account?.['sourceAccountId']);
  if (
    account?.['userId'] !== userId ||
    accountSourceAccountId === null ||
    (account['status'] !== 'active' && account['status'] !== 'disabled') ||
    account['erasureStatus'] !== undefined
  ) {
    return false;
  }

  const sessionSourceAccountId = readOptionalNonEmptyString(session, 'sourceAccountId');
  if (sessionSourceAccountId === false) return false;
  const continuation = asOptionalRecord(session?.['continuation']);
  const continuationSourceAccountId = readOptionalNonEmptyString(
    continuation,
    'sourceAccountId'
  );
  if (continuationSourceAccountId === false) return false;
  if (
    sessionSourceAccountId !== undefined &&
    continuationSourceAccountId !== undefined &&
    sessionSourceAccountId !== continuationSourceAccountId
  ) {
    return false;
  }

  let expectedSourceAccountId = sessionSourceAccountId ?? continuationSourceAccountId;
  if (expectedSourceAccountId === undefined) {
    const chatId = readNonEmptyString(session?.['chatId']);
    if (chatId === null) return false;
    const chatSnapshot = await readDocument(
      input.db.collection(PRIVATE_WHATSAPP_CHATS_COLLECTION).doc(chatId),
      input.transaction
    );
    const chat = chatSnapshot.exists ? chatSnapshot.data() : undefined;
    if (chat?.['userId'] !== userId) return false;
    expectedSourceAccountId = readNonEmptyString(chat['sourceAccountId']) ?? undefined;
    if (expectedSourceAccountId === undefined) return false;
  }
  if (accountSourceAccountId !== expectedSourceAccountId) return false;

  const expectedGeneration = readOptionalNonEmptyString(session, 'sourceAccountGeneration');
  if (
    expectedGeneration === false ||
    (input.requireSourceAccountGeneration === true && expectedGeneration === undefined)
  ) {
    return false;
  }
  const accountGeneration = readAccountGeneration(account, accountSourceAccountId);
  return accountGeneration !== null &&
    (expectedGeneration === undefined || accountGeneration === expectedGeneration);
}

async function readDocument(
  reference: FirebaseFirestore.DocumentReference,
  transaction: FirebaseFirestore.Transaction | undefined
): Promise<FirebaseFirestore.DocumentSnapshot> {
  return transaction === undefined ? await reference.get() : await transaction.get(reference);
}

function readAccountGeneration(
  account: Record<string, unknown>,
  sourceAccountId: string
): string | null {
  if (!Object.prototype.hasOwnProperty.call(account, 'generationId')) return sourceAccountId;
  return readNonEmptyString(account['generationId']);
}

function readOptionalNonEmptyString(
  value: Record<string, unknown> | undefined,
  key: string
): string | undefined | false {
  if (value === undefined || !Object.prototype.hasOwnProperty.call(value, key)) return undefined;
  return readNonEmptyString(value[key]) ?? false;
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function asOptionalRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
