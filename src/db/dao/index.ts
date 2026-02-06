// Interfaces
export type { TeamDao } from './interfaces/team.dao.js';
export type { AgentDao, StaleAgent } from './interfaces/agent.dao.js';
export type { StoryDao } from './interfaces/story.dao.js';
export type { RequirementDao } from './interfaces/requirement.dao.js';
export type { PullRequestDao } from './interfaces/pull-request.dao.js';
export type { EscalationDao } from './interfaces/escalation.dao.js';
export type { LogDao } from './interfaces/log.dao.js';
export type { MessageDao } from './interfaces/message.dao.js';

// Composite
export type { HiveDao } from './hive-dao.js';
export { createSqliteHiveDao } from './hive-dao.js';
export { createLevelDbHiveDao } from './leveldb/hive-dao.js';

// SQLite implementations
export {
  SqliteTeamDao,
  SqliteAgentDao,
  SqliteStoryDao,
  SqliteRequirementDao,
  SqlitePullRequestDao,
  SqliteEscalationDao,
  SqliteLogDao,
  SqliteMessageDao,
} from './sqlite/index.js';

// LevelDB implementations
export {
  LevelDbStore,
  LevelDbTeamDao,
  LevelDbAgentDao,
  LevelDbStoryDao,
  LevelDbRequirementDao,
  LevelDbPullRequestDao,
  LevelDbEscalationDao,
  LevelDbLogDao,
  LevelDbMessageDao,
} from './leveldb/index.js';
