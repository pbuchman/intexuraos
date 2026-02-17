/**
 * Metrics service interface for code task operations.
 *
 * Defines the contract for recording operational metrics about code tasks.
 * Implementations write to monitoring systems like Google Cloud Monitoring.
 */

/**
 * Metrics client interface for code task operations.
 */
export interface MetricsClient {
  /**
   * Record a task submission event.
   * @param workerType - The worker type (opus, auto, glm)
   * @param source - The submission source (whatsapp, web)
   */
  incrementTasksSubmitted(workerType: string, source: string): Promise<void>;

  /**
   * Record a task completion event.
   * @param workerType - The worker type (opus, auto, glm)
   * @param status - The completion status (completed, failed, cancelled, timeout)
   */
  incrementTasksCompleted(workerType: string, status: string): Promise<void>;

  /**
   * Record the duration of a task execution.
   * @param workerType - The worker type (opus, auto, glm)
   * @param durationSeconds - The duration in seconds
   */
  recordTaskDuration(workerType: string, durationSeconds: number): Promise<void>;

  /**
   * Set the current count of active tasks.
   * @param workerLocation - The worker location (mac, vm)
   * @param count - The number of active tasks
   */
  setActiveTasks(workerLocation: string, count: number): Promise<void>;

  /**
   * Record the estimated cost of a task.
   * @param workerType - The worker type (opus, auto, glm)
   * @param userId - The user ID for cost attribution
   * @param dollars - The cost in dollars
   */
  recordCost(workerType: string, userId: string, dollars: number): Promise<void>;
}
