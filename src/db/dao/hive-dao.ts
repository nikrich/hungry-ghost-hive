import type { Database } from 'sql.js';
import type { TeamDao } from './interfaces/team.dao.js';
import type { AgentDao } from './interfaces/agent.dao.js';
import type { StoryDao } from './interfaces/story.dao.js';
import type { RequirementDao } from './interfaces/requirement.dao.js';
import type { PullRequestDao } from './interfaces/pull-request.dao.js';
import type { EscalationDao } from './interfaces/escalation.dao.js';
import type { LogDao } from './interfaces/log.dao.js';
import type { MessageDao } from './interfaces/message.dao.js';
import { SqliteTeamDao } from './sqlite/team.sqlite-dao.js';
import { SqliteAgentDao } from './sqlite/agent.sqlite-dao.js';
import { SqliteStoryDao } from './sqlite/story.sqlite-dao.js';
import { SqliteRequirementDao } from './sqlite/requirement.sqlite-dao.js';
import { SqlitePullRequestDao } from './sqlite/pull-request.sqlite-dao.js';
import { SqliteEscalationDao } from './sqlite/escalation.sqlite-dao.js';
import { SqliteLogDao } from './sqlite/log.sqlite-dao.js';
import { SqliteMessageDao } from './sqlite/message.sqlite-dao.js';

export interface HiveDao {
  readonly teams: TeamDao;
  readonly agents: AgentDao;
  readonly stories: StoryDao;
  readonly requirements: RequirementDao;
  readonly pullRequests: PullRequestDao;
  readonly escalations: EscalationDao;
  readonly logs: LogDao;
  readonly messages: MessageDao;
}

export function createSqliteHiveDao(db: Database): HiveDao {
  return {
    teams: new SqliteTeamDao(db),
    agents: new SqliteAgentDao(db),
    stories: new SqliteStoryDao(db),
    requirements: new SqliteRequirementDao(db),
    pullRequests: new SqlitePullRequestDao(db),
    escalations: new SqliteEscalationDao(db),
    logs: new SqliteLogDao(db),
    messages: new SqliteMessageDao(db),
  };
}
