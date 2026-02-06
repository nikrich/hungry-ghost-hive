import type { Level } from 'level';
import type { HiveDao } from '../hive-dao.js';
import { LevelDbStore, defaultNow, type NowProvider } from './leveldb-store.js';
import { LevelDbTeamDao } from './team.leveldb-dao.js';
import { LevelDbAgentDao } from './agent.leveldb-dao.js';
import { LevelDbStoryDao } from './story.leveldb-dao.js';
import { LevelDbRequirementDao } from './requirement.leveldb-dao.js';
import { LevelDbPullRequestDao } from './pull-request.leveldb-dao.js';
import { LevelDbEscalationDao } from './escalation.leveldb-dao.js';
import { LevelDbLogDao } from './log.leveldb-dao.js';
import { LevelDbMessageDao } from './message.leveldb-dao.js';

export interface LevelDbHiveDaoOptions {
  now?: NowProvider;
}

export function createLevelDbHiveDao(db: Level<string, unknown>, options: LevelDbHiveDaoOptions = {}): HiveDao {
  const store = new LevelDbStore(db);
  const now = options.now ?? defaultNow;

  return {
    teams: new LevelDbTeamDao(store, now),
    agents: new LevelDbAgentDao(store, now),
    stories: new LevelDbStoryDao(store, now),
    requirements: new LevelDbRequirementDao(store, now),
    pullRequests: new LevelDbPullRequestDao(store, now),
    escalations: new LevelDbEscalationDao(store, now),
    logs: new LevelDbLogDao(store, now),
    messages: new LevelDbMessageDao(store),
  };
}
