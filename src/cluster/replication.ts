// Licensed under the Hungry Ghost Hive License. See LICENSE.

// Re-export types
export type {
  ClusterEvent,
  ClusterEventVersion,
  ReplicatedTable,
  ReplicationOp,
  VersionVector,
} from './types.js';

// Re-export event functions
export {
  ensureClusterTables,
  getAllClusterEvents,
  getDeltaEvents,
  getVersionVector,
} from './events.js';

// Re-export sync functions
export { applyRemoteEvents, scanLocalChanges } from './sync.js';

// Re-export story merge function
export { mergeSimilarStories } from './story-merge.js';
