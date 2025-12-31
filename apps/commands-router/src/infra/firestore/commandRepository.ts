import { getFirestore } from '@intexuraos/infra-firestore';
import type { Command, CommandClassification } from '../../domain/models/command.js';
import type { CommandRepository } from '../../domain/ports/commandRepository.js';

const COLLECTION = 'commands';

interface CommandDoc {
  userId: string;
  sourceType: string;
  externalId: string;
  text: string;
  timestamp: string;
  status: string;
  classification?: {
    type: string;
    confidence: number;
    classifiedAt: string;
  };
  actionId?: string;
  createdAt: string;
  updatedAt: string;
}

function toCommand(id: string, doc: CommandDoc): Command {
  const command: Command = {
    id,
    userId: doc.userId,
    sourceType: doc.sourceType as Command['sourceType'],
    externalId: doc.externalId,
    text: doc.text,
    timestamp: doc.timestamp,
    status: doc.status as Command['status'],
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };

  if (doc.classification !== undefined) {
    command.classification = {
      type: doc.classification.type as CommandClassification['type'],
      confidence: doc.classification.confidence,
      classifiedAt: doc.classification.classifiedAt,
    };
  }

  if (doc.actionId !== undefined) {
    command.actionId = doc.actionId;
  }

  return command;
}

function toDoc(command: Command): CommandDoc {
  const doc: CommandDoc = {
    userId: command.userId,
    sourceType: command.sourceType,
    externalId: command.externalId,
    text: command.text,
    timestamp: command.timestamp,
    status: command.status,
    createdAt: command.createdAt,
    updatedAt: command.updatedAt,
  };

  if (command.classification !== undefined) {
    doc.classification = command.classification;
  }

  if (command.actionId !== undefined) {
    doc.actionId = command.actionId;
  }

  return doc;
}

export function createFirestoreCommandRepository(): CommandRepository {
  return {
    async getById(id: string): Promise<Command | null> {
      const db = getFirestore();
      const docRef = db.collection(COLLECTION).doc(id);
      const snapshot = await docRef.get();

      if (!snapshot.exists) {
        return null;
      }

      return toCommand(id, snapshot.data() as CommandDoc);
    },

    async save(command: Command): Promise<void> {
      const db = getFirestore();
      const docRef = db.collection(COLLECTION).doc(command.id);
      await docRef.set(toDoc(command));
    },

    async update(command: Command): Promise<void> {
      const db = getFirestore();
      const docRef = db.collection(COLLECTION).doc(command.id);
      await docRef.update({
        ...toDoc(command),
        updatedAt: new Date().toISOString(),
      });
    },

    async listByUserId(userId: string): Promise<Command[]> {
      const db = getFirestore();
      const snapshot = await db
        .collection(COLLECTION)
        .where('userId', '==', userId)
        .orderBy('createdAt', 'desc')
        .limit(100)
        .get();

      return snapshot.docs.map((doc) => toCommand(doc.id, doc.data() as CommandDoc));
    },
  };
}
