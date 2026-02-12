// Licensed under the Hungry Ghost Hive License. See LICENSE.

import * as logger from '../../utils/logger.js';

/**
 * Represents a Jira operation to be executed
 */
interface JiraOperation {
  id: string;
  execute: () => Promise<void>;
}

/**
 * Queue for serializing Jira API operations to prevent race conditions.
 *
 * When multiple stories are assigned concurrently, Jira operations (subtask creation,
 * comments, status transitions) are queued and executed sequentially to avoid:
 * - TokenStore file lock contention
 * - Jira API rate limiting
 * - Concurrent token refresh issues
 */
export class JiraOperationQueue {
  private queue: JiraOperation[] = [];
  private processing = false;

  /**
   * Add a Jira operation to the queue
   * @param id - Unique identifier for logging (e.g., story ID)
   * @param operation - Async function that performs the Jira operation
   */
  enqueue(id: string, operation: () => Promise<void>): void {
    this.queue.push({ id, execute: operation });

    // Start processing if not already running
    if (!this.processing) {
      this.processQueue().catch(err => {
        logger.error(
          `Jira operation queue processing failed: ${err instanceof Error ? err.message : String(err)}`
        );
      });
    }
  }

  /**
   * Process all queued operations sequentially
   */
  private async processQueue(): Promise<void> {
    if (this.processing) {
      return;
    }

    this.processing = true;

    while (this.queue.length > 0) {
      const operation = this.queue.shift();
      if (!operation) continue;

      try {
        logger.debug(`Processing Jira operation for ${operation.id}`);
        await operation.execute();
      } catch (err) {
        // Log error but continue processing other operations
        logger.warn(
          `Jira operation failed for ${operation.id}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    this.processing = false;
  }

  /**
   * Get the number of pending operations
   */
  size(): number {
    return this.queue.length;
  }

  /**
   * Wait for all queued operations to complete
   * Useful for testing and ensuring operations complete before exiting
   */
  async waitForCompletion(): Promise<void> {
    while (this.processing || this.queue.length > 0) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
}
