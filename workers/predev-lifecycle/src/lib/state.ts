import { Firestore, Timestamp } from '@google-cloud/firestore';
import { logger } from './logger.js';

export interface PredevState {
  status: 'stopped' | 'starting' | 'running' | 'stopping';
  vmIp: string | null;
  branch: string;
  lastActivity: Date;
  startedAt: Date | null;
}

const COLLECTION = 'predev-state';
const DOC_ID = 'current';

type FirestoreData = Record<string, unknown>;

export class StateManager {
  private db: Firestore;

  constructor() {
    this.db = new Firestore();
  }

  async getState(): Promise<PredevState | null> {
    try {
      const doc = await this.db.collection(COLLECTION).doc(DOC_ID).get();
      if (!doc.exists) return null;

      const data = doc.data() as FirestoreData | undefined;
      if (!data) return null;

      const toDate = (value: unknown): Date | null => {
        if (value instanceof Timestamp) {
          return value.toDate();
        }
        if (typeof value === 'string') {
          return new Date(value);
        }
        return null;
      };

      return {
        status: (data['status'] ?? 'stopped') as PredevState['status'],
        vmIp: (data['vmIp'] ?? null) as string | null,
        branch: (data['branch'] ?? 'development') as string,
        lastActivity: toDate(data['lastActivity']) ?? new Date(),
        startedAt: toDate(data['startedAt']),
      };
    } catch (error) {
      logger.error({ error }, 'Failed to get state');
      return null;
    }
  }

  async setState(state: Partial<PredevState>): Promise<void> {
    try {
      await this.db.collection(COLLECTION).doc(DOC_ID).set(state, { merge: true });
    } catch (error) {
      logger.error({ error }, 'Failed to set state');
    }
  }

  async updateActivity(): Promise<void> {
    await this.setState({ lastActivity: new Date() });
  }

  async setRunning(ip: string, branch: string): Promise<void> {
    await this.setState({
      status: 'running',
      vmIp: ip,
      branch,
      lastActivity: new Date(),
      startedAt: new Date(),
    });
  }

  async setStarting(): Promise<void> {
    await this.setState({ status: 'starting' });
  }

  async setStopped(): Promise<void> {
    await this.setState({
      status: 'stopped',
      vmIp: null,
      startedAt: null,
    });
  }

  async setStopping(): Promise<void> {
    await this.setState({ status: 'stopping' });
  }
}
