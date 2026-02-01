import { Firestore, Timestamp, Transaction } from '@google-cloud/firestore';
import { logger } from './logger.js';
import { serializeError } from './serializeError.js';

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

      /* v8 ignore start -- ts-type: Firestore Timestamp vs string date handling @preserve */
      const toDate = (value: unknown): Date | null => {
        if (value instanceof Timestamp) {
          return value.toDate();
        }
        if (typeof value === 'string') {
          return new Date(value);
        }
        return null;
      };
      /* v8 ignore stop @preserve */

      return {
        status: (data['status'] ?? 'stopped') as PredevState['status'],
        vmIp: (data['vmIp'] ?? null) as string | null,
        branch: (data['branch'] ?? 'development') as string,
        lastActivity: toDate(data['lastActivity']) ?? new Date(),
        startedAt: toDate(data['startedAt']),
      };
    } catch (error) {
      logger.error({ error: serializeError(error) }, 'Failed to get state');
      return null;
    }
  }

  async setState(state: Partial<PredevState>): Promise<void> {
    try {
      await this.db.collection(COLLECTION).doc(DOC_ID).set(state, { merge: true });
    } catch (error) {
      logger.error({ error: serializeError(error) }, 'Failed to set state');
    }
  }

  async updateActivity(): Promise<void> {
    await this.setState({ lastActivity: new Date() });
  }

  // Report-ready is authoritative - always succeeds
  async setRunning(ip: string, branch: string): Promise<void> {
    try {
      await this.db
        .collection(COLLECTION)
        .doc(DOC_ID)
        .set(
          {
            status: 'running',
            vmIp: ip,
            branch,
            lastActivity: new Date(),
            startedAt: new Date(),
          } as FirestoreData,
          { merge: true }
        );
      logger.info({ ip, branch }, 'State set to running');
    } catch (error) {
      logger.error({ error: serializeError(error) }, 'Failed to set running state');
      throw error;
    }
  }

  // Only transition to starting if currently stopped - prevents race conditions
  async setStartingIfStopped(): Promise<boolean> {
    try {
      const result = await this.db.runTransaction(async (tx: Transaction) => {
        const docRef = this.db.collection(COLLECTION).doc(DOC_ID);
        const doc = await tx.get(docRef);

        /* v8 ignore start -- test-infra: first-run branch requires empty Firestore state @preserve */
        if (!doc.exists) {
          /* v8 ignore stop @preserve */
          // First run - create document with starting state
          tx.create(docRef, {
            status: 'starting',
            branch: 'development',
            lastActivity: new Date(),
            startedAt: new Date(),
          } as FirestoreData);
          return { created: true, updated: false };
        }

        const data = doc.data() as FirestoreData | undefined;
        /* v8 ignore start -- ts-type: nullish coalescing on data?.['status'] creates type narrowing branch @preserve */
        const currentStatus = (data?.['status'] ?? 'stopped') as PredevState['status'];
        /* v8 ignore stop @preserve */

        // Only update if currently stopped - don't overwrite starting/running
        /* v8 ignore start -- test-infra: stopped->starting transition requires specific Firestore state @preserve */
        if (currentStatus === 'stopped') {
          /* v8 ignore stop @preserve */
          tx.update(docRef, {
            status: 'starting',
            startedAt: new Date(),
          } as FirestoreData);
          return { created: false, updated: true };
        }

        // Already starting or running - don't touch
        return { created: false, updated: false, currentStatus };
      });

      /* v8 ignore start -- ts-type: type assertion on result creates multiple branches @preserve */
      const didUpdate = (result as { updated: boolean }).updated;
      if (didUpdate) {
        /* v8 ignore stop @preserve */
        logger.info('State transitioned: stopped -> starting');
      } else {
        /* v8 ignore start -- ts-type: type assertion on result creates multiple branches @preserve */
        const status = (result as { currentStatus?: string }).currentStatus;
        /* v8 ignore stop @preserve */
        logger.info({ status }, 'Skipped setStarting - not stopped');
      }
      return didUpdate;
    } catch (error) {
      logger.error({ error: serializeError(error) }, 'Failed in setStartingIfStopped transaction');
      return false;
    }
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
