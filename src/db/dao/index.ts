// Interfaces
export type { AgentDao, StaleAgent } from './interfaces/agent.dao.js';
export type { EscalationDao } from './interfaces/escalation.dao.js';
export type { LogDao } from './interfaces/log.dao.js';
export type { MessageDao } from './interfaces/message.dao.js';
export type { PullRequestDao } from './interfaces/pull-request.dao.js';
export type { RequirementDao } from './interfaces/requirement.dao.js';
export type { StoryDao } from './interfaces/story.dao.js';
export type { TeamDao } from './interfaces/team.dao.js';

// Composite
export { createSqliteHiveDao } from './hive-dao.js';
export type { HiveDao } from './hive-dao.js';
export { createLevelDbHiveDao } from './leveldb/hive-dao.js';

// SQLite implementations
export {
  SqliteAgentDao,
  SqliteEscalationDao,
  SqliteLogDao,
  SqliteMessageDao,
  SqlitePullRequestDao,
  SqliteRequirementDao,
  SqliteStoryDao,
  SqliteTeamDao,
} from './sqlite/index.js';

// LevelDB implementations
export {
  LevelDbAgentDao,
  LevelDbEscalationDao,
  LevelDbLogDao,
  LevelDbMessageDao,
  LevelDbPullRequestDao,
  LevelDbRequirementDao,
  LevelDbStore,
  LevelDbStoryDao,
  LevelDbTeamDao,
} from './leveldb/index.js';
