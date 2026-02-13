// Licensed under the Hungry Ghost Hive License. See LICENSE.

import * as logger from '../../utils/logger.js';

/**
 * Represents a PM operation to be executed
 */
interface PMOperation {
  id: string;
  execute: () => Promise<void>;
}

/**
 * Queue for serializing project management API operations to prevent race conditions.
 *
 * When multiple stories are assigned concurrently, PM operations (subtask creation,
 * comments, status transitions) are queued and executed sequentially to avoid:
 * - TokenStore file lock contention
 * - API rate limiting
 * - Concurrent token refresh issues
 */
export class PMOperationQueue {
  private queue: PMOperation[] = [];
  private processing = false;

  /**
   * Add a PM operation to the queue
   * @param id - Unique identifier for logging (e.g., story ID)
   * @param operation - Async function that performs the PM operation
   */
  enqueue(id: string, operation: () => Promise<void>): void {
    this.queue.push({ id, execute: operation });

    // Start processing if not already running
    if (!this.processing) {
      this.processQueue().catch(err => {
        logger.error(
          `PM operation queue processing failed: ${err instanceof Error ? err.message : String(err)}`
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
        logger.debug(`Processing PM operation for ${operation.id}`);
        await operation.execute();
      } catch (err) {
        // Log error but continue processing other operations
        logger.warn(
          `PM operation failed for ${operation.id}: ${err instanceof Error ? err.message : String(err)}`
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
