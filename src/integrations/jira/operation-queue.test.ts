// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { describe, expect, it } from 'vitest';
import { JiraOperationQueue } from './operation-queue.js';

describe('JiraOperationQueue', () => {
  it('should process operations sequentially', async () => {
    const queue = new JiraOperationQueue();
    const results: number[] = [];

    // Add operations that record their execution order
    queue.enqueue('op1', async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
      results.push(1);
    });

    queue.enqueue('op2', async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
      results.push(2);
    });

    queue.enqueue('op3', async () => {
      results.push(3);
    });

    // Wait for all operations to complete
    await queue.waitForCompletion();

    // Operations should execute in order despite different delays
    expect(results).toEqual([1, 2, 3]);
  });

  it('should continue processing after an operation fails', async () => {
    const queue = new JiraOperationQueue();
    const results: string[] = [];

    queue.enqueue('success1', async () => {
      results.push('success1');
    });

    queue.enqueue('failure', async () => {
      results.push('failure-attempted');
      throw new Error('Operation failed');
    });

    queue.enqueue('success2', async () => {
      results.push('success2');
    });

    await queue.waitForCompletion();

    // All operations should execute, including those after the failure
    expect(results).toEqual(['success1', 'failure-attempted', 'success2']);
  });

  it('should report correct queue size', async () => {
    const queue = new JiraOperationQueue();

    expect(queue.size()).toBe(0);

    // Add operations with delays so they don't complete immediately
    queue.enqueue('op1', async () => {
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    queue.enqueue('op2', async () => {
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    queue.enqueue('op3', async () => {
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    // Give the queue a moment to start processing
    await new Promise(resolve => setTimeout(resolve, 10));

    // First operation should be processing, two should be queued
    expect(queue.size()).toBeLessThanOrEqual(3);

    await queue.waitForCompletion();

    expect(queue.size()).toBe(0);
  });

  it('should handle concurrent enqueue calls', async () => {
    const queue = new JiraOperationQueue();
    const results: number[] = [];

    // Enqueue operations concurrently
    const enqueuePromises = [
      Promise.resolve(queue.enqueue('op1', async () => { results.push(1); })),
      Promise.resolve(queue.enqueue('op2', async () => { results.push(2); })),
      Promise.resolve(queue.enqueue('op3', async () => { results.push(3); })),
      Promise.resolve(queue.enqueue('op4', async () => { results.push(4); })),
      Promise.resolve(queue.enqueue('op5', async () => { results.push(5); })),
    ];

    await Promise.all(enqueuePromises);
    await queue.waitForCompletion();

    // All operations should execute
    expect(results).toHaveLength(5);
    expect(results.sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('should execute operations in FIFO order', async () => {
    const queue = new JiraOperationQueue();
    const results: string[] = [];

    queue.enqueue('first', async () => { results.push('first'); });
    queue.enqueue('second', async () => { results.push('second'); });
    queue.enqueue('third', async () => { results.push('third'); });
    queue.enqueue('fourth', async () => { results.push('fourth'); });

    await queue.waitForCompletion();

    expect(results).toEqual(['first', 'second', 'third', 'fourth']);
  });
});
