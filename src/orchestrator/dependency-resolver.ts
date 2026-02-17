// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type Database from 'better-sqlite3';
import {
  getBatchStoryDependencies,
  getStoryDependencies,
  type StoryRow,
} from '../db/queries/stories.js';

/**
 * Build a dependency graph for stories.
 * Returns a map of story ID to its direct dependencies.
 */
export function buildDependencyGraph(db: Database.Database, stories: StoryRow[]): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();
  const storyIds = new Set(stories.map(s => s.id));

  // Initialize all stories in the graph
  for (const story of stories) {
    if (!graph.has(story.id)) {
      graph.set(story.id, new Set());
    }
  }

  // Fetch all dependencies in a single query to avoid N+1 pattern
  const allDepsMap = getBatchStoryDependencies(db, Array.from(storyIds));

  // Add dependencies (only within the planned set; external deps handled by areDependenciesSatisfied)
  for (const [storyId, depIds] of allDepsMap) {
    for (const depId of depIds) {
      if (storyIds.has(depId)) {
        graph.get(storyId)!.add(depId);
      }
    }
  }

  return graph;
}

/**
 * Topological sort of stories based on dependencies.
 * Returns stories in order where dependencies come before dependents.
 * Returns null if circular dependency is detected.
 */
export function topologicalSort(db: Database.Database, stories: StoryRow[]): StoryRow[] | null {
  const graph = buildDependencyGraph(db, stories);
  const storyMap = new Map(stories.map(s => [s.id, s]));

  // Kahn's algorithm for topological sort
  const inDegree = new Map<string, number>();
  const result: StoryRow[] = [];

  // Calculate in-degrees: count how many dependencies each story has
  for (const [storyId, dependencies] of graph.entries()) {
    inDegree.set(storyId, dependencies.size);
  }

  // Find all nodes with in-degree 0 (no dependencies)
  const queue: string[] = [];
  for (const [storyId, degree] of inDegree.entries()) {
    if (degree === 0) {
      queue.push(storyId);
    }
  }

  // Process queue using Kahn's algorithm
  while (queue.length > 0) {
    const storyId = queue.shift()!;
    const story = storyMap.get(storyId);
    if (story) {
      result.push(story);
    }

    // For each story that depends on this one, reduce in-degree
    for (const [otherStoryId, dependencies] of graph.entries()) {
      if (dependencies.has(storyId)) {
        const newDegree = (inDegree.get(otherStoryId) || 0) - 1;
        inDegree.set(otherStoryId, newDegree);
        if (newDegree === 0) {
          queue.push(otherStoryId);
        }
      }
    }
  }

  // Check for circular dependencies
  if (result.length !== stories.length) {
    return null;
  }

  return result;
}

/**
 * Check if a story's dependencies are satisfied.
 * A dependency is satisfied only if it's merged (completed).
 */
export function areDependenciesSatisfied(db: Database.Database, storyId: string): boolean {
  const dependencies = getStoryDependencies(db, storyId);

  for (const dep of dependencies) {
    // Check if dependency is in a terminal state (merged)
    if (dep.status !== 'merged') {
      return false;
    }
  }

  return true;
}
