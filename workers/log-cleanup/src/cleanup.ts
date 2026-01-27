import admin from 'firebase-admin';
import { logger } from './logger.js';

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();

const BATCH_SIZE = 500;
const RETENTION_DAYS = 90;
const TASKS_PER_RUN = 100;

export interface CleanupResult {
  success: boolean;
  message: string;
  tasksProcessed: number;
  tasksFailed: number;
  logsDeleted: number;
  durationMs: number;
}

export async function cleanupOldLogs(): Promise<CleanupResult> {
  const startTime = Date.now();
  let tasksProcessed = 0;
  let tasksFailed = 0;
  let logsDeleted = 0;

  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);
    const cutoffTimestamp = admin.firestore.Timestamp.fromDate(cutoffDate);

    logger.info({ cutoffDate: cutoffDate.toISOString() }, 'Starting log cleanup');

    let hasMoreTasks = true;

    while (hasMoreTasks) {
      const tasksSnapshot = await db
        .collection('code_tasks')
        .where('completedAt', '<', cutoffTimestamp)
        .where('logsArchived', '==', false)
        .limit(TASKS_PER_RUN)
        .get();

      if (tasksSnapshot.empty) {
        hasMoreTasks = false;
        break;
      }

      for (const taskDoc of tasksSnapshot.docs) {
        try {
          const taskId = taskDoc.id;
          logger.debug({ taskId }, 'Processing task for log cleanup');

          const logsSnapshot = await taskDoc.ref.collection('logs').get();
          const logCount = logsSnapshot.docs.length;

          if (logCount > 0) {
            let batch = db.batch();
            let batchCount = 0;

            for (const logDoc of logsSnapshot.docs) {
              batch.delete(logDoc.ref);
              batchCount++;
              logsDeleted++;

              if (batchCount >= BATCH_SIZE) {
                await batch.commit();
                batch = db.batch();
                batchCount = 0;
              }
            }

            if (batchCount > 0) {
              await batch.commit();
            }
          }

          await taskDoc.ref.update({
            logsArchived: true,
            logCount,
            archivedAt: admin.firestore.FieldValue.serverTimestamp(),
          });

          tasksProcessed++;
          logger.info({ taskId, logCount }, 'Task logs archived');
        } catch (error) {
          tasksFailed++;
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.error({ taskId: taskDoc.id, error: errorMessage }, 'Failed to process task');
        }
      }

      if (tasksSnapshot.docs.length < TASKS_PER_RUN) {
        hasMoreTasks = false;
      }
    }

    const durationMs = Date.now() - startTime;

    if (tasksProcessed === 0 && tasksFailed === 0) {
      logger.info({ durationMs }, 'No tasks require log cleanup');
      return {
        success: true,
        message: 'No tasks require log cleanup',
        tasksProcessed: 0,
        tasksFailed: 0,
        logsDeleted: 0,
        durationMs,
      };
    }

    logger.info({ tasksProcessed, tasksFailed, logsDeleted, durationMs }, 'Log cleanup completed');

    return {
      success: true,
      message: `Processed ${String(tasksProcessed)} tasks, deleted ${String(logsDeleted)} logs`,
      tasksProcessed,
      tasksFailed,
      logsDeleted,
      durationMs,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const durationMs = Date.now() - startTime;

    logger.error({ error: errorMessage, durationMs }, 'Log cleanup failed');

    return {
      success: false,
      message: errorMessage,
      tasksProcessed,
      tasksFailed,
      logsDeleted,
      durationMs,
    };
  }
}
