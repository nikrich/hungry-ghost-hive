// Licensed under the Hungry Ghost Hive License. See LICENSE.

import chalk from 'chalk';
import { Command } from 'commander';
import { getActiveAgents, getAllAgents } from '../../db/queries/agents.js';
import { getPendingEscalations, getPendingHumanEscalations } from '../../db/queries/escalations.js';
import { getLogsByStory, getRecentLogs } from '../../db/queries/logs.js';
import { getPendingRequirements, getRequirementById } from '../../db/queries/requirements.js';
import {
  getStoriesByTeam,
  getStoryById,
  getStoryCounts,
  getStoryDependencies,
} from '../../db/queries/stories.js';
import { getAllTeams, getTeamByName } from '../../db/queries/teams.js';
import { statusColor } from '../../utils/logger.js';
import { withReadOnlyHiveContext } from '../../utils/with-hive-context.js';

export const statusCommand = new Command('status')
  .description('Show Hive status')
  .option('--team <name>', 'Show status for a specific team')
  .option('--story <id>', 'Show status for a specific story')
  .option('--json', 'Output as JSON')
  .action(async (options: { team?: string; story?: string; json?: boolean }) => {
    await withReadOnlyHiveContext(({ db }) => {
      if (options.story) {
        showStoryStatus(db.db, options.story, options.json);
      } else if (options.team) {
        showTeamStatus(db.db, options.team, options.json);
      } else {
        showOverallStatus(db.db, options.json);
      }
    });
  });

function showOverallStatus(db: import('better-sqlite3').Database, json?: boolean): void {
  const teams = getAllTeams(db);
  const allAgents = getAllAgents(db);
  const activeAgents = getActiveAgents(db);
  const storyCounts = getStoryCounts(db);
  const requirements = getPendingRequirements(db);
  const escalations = getPendingEscalations(db);
  const approvals = getPendingHumanEscalations(db);
  const recentLogs = getRecentLogs(db, 5);

  const terminatedAgents = allAgents.filter(a => a.status === 'terminated').length;

  const status = {
    teams: teams.length,
    agents: {
      total: allAgents.length,
      active: activeAgents.length,
      working: activeAgents.filter(a => a.status === 'working').length,
      idle: activeAgents.filter(a => a.status === 'idle').length,
      blocked: activeAgents.filter(a => a.status === 'blocked').length,
      terminated: terminatedAgents,
    },
    stories: storyCounts,
    requirements: {
      pending: requirements.length,
      items: requirements.map(r => ({
        id: r.id,
        title: r.title,
        godmode: r.godmode ? true : false,
      })),
    },
    escalations: {
      pending: escalations.length,
    },
    approvals: {
      pending: approvals.length,
    },
    recentActivity: recentLogs.map(l => ({
      timestamp: l.timestamp,
      agent: l.agent_id,
      event: l.event_type,
      message: l.message,
    })),
  };

  if (json) {
    console.log(JSON.stringify(status, null, 2));
    return;
  }

  console.log(chalk.bold('\n📊 Hive Status\n'));

  // Teams
  console.log(chalk.bold('Teams:'), teams.length);
  for (const team of teams) {
    console.log(chalk.gray(`  • ${team.name}`));
  }
  console.log();

  // Agents
  console.log(chalk.bold('Agents:'));
  const totalDisplay =
    status.agents.terminated > 0
      ? `${status.agents.total} (${status.agents.terminated} terminated)`
      : status.agents.total.toString();
  console.log(`  Total:   ${totalDisplay}`);
  console.log(`  Working: ${chalk.yellow(status.agents.working.toString())}`);
  console.log(`  Idle:    ${chalk.gray(status.agents.idle.toString())}`);
  console.log(`  Blocked: ${chalk.red(status.agents.blocked.toString())}`);
  console.log();

  // Story Pipeline
  console.log(chalk.bold('Story Pipeline:'));
  console.log(`  Draft:        ${storyCounts.draft}`);
  console.log(`  Estimated:    ${storyCounts.estimated}`);
  console.log(`  Planned:      ${storyCounts.planned}`);
  console.log(`  In Progress:  ${chalk.yellow(storyCounts.in_progress.toString())}`);
  console.log(`  Review:       ${storyCounts.review}`);
  console.log(`  QA:           ${storyCounts.qa}`);
  console.log(`  QA Failed:    ${chalk.red(storyCounts.qa_failed.toString())}`);
  console.log(`  PR Submitted: ${chalk.blue(storyCounts.pr_submitted.toString())}`);
  console.log(`  Merged:       ${chalk.green(storyCounts.merged.toString())}`);
  console.log();

  // Pending items
  if (requirements.length > 0) {
    console.log(chalk.bold('Pending Requirements:'), requirements.length);
    for (const req of requirements.slice(0, 3)) {
      const godmodeIndicator = req.godmode ? chalk.yellow(' ⚡') : '';
      console.log(chalk.gray(`  • ${req.id}: ${req.title.substring(0, 50)}...${godmodeIndicator}`));
    }
    console.log();
  }

  if (escalations.length > 0) {
    console.log(chalk.bold.red('⚠ Pending Escalations:'), escalations.length);
    for (const esc of escalations) {
      console.log(chalk.yellow(`  • ${esc.id}: ${esc.reason.substring(0, 50)}...`));
    }
    console.log();
  }

  if (approvals.length > 0) {
    console.log(chalk.bold.yellow('⏳ Pending Human Approvals:'), approvals.length);
    console.log(chalk.gray('  • Run: hive approvals list'));
    console.log();
  }

  // Recent Activity
  if (recentLogs.length > 0) {
    console.log(chalk.bold('Recent Activity:'));
    for (const log of recentLogs) {
      const time = log.timestamp.substring(11, 19);
      console.log(chalk.gray(`  ${time} | ${log.agent_id.padEnd(15)} | ${log.event_type}`));
    }
    console.log();
  }
}

function showTeamStatus(db: import('better-sqlite3').Database, teamName: string, json?: boolean): void {
  const team = getTeamByName(db, teamName);
  if (!team) {
    console.error(chalk.red(`Team not found: ${teamName}`));
    process.exit(1);
  }

  const stories = getStoriesByTeam(db, team.id);
  const activeAgents = getActiveAgents(db).filter(a => a.team_id === team.id);

  const storyCounts: Record<string, number> = {};
  for (const story of stories) {
    storyCounts[story.status] = (storyCounts[story.status] || 0) + 1;
  }

  const status = {
    team: {
      id: team.id,
      name: team.name,
      repo_url: team.repo_url,
      repo_path: team.repo_path,
    },
    agents: activeAgents.map(a => {
      let godmode = false;
      if (a.current_story_id) {
        const story = getStoryById(db, a.current_story_id);
        if (story && story.requirement_id) {
          const requirement = getRequirementById(db, story.requirement_id);
          godmode = requirement?.godmode ? true : false;
        }
      }
      return {
        id: a.id,
        type: a.type,
        status: a.status,
        currentStory: a.current_story_id,
        godmode,
      };
    }),
    stories: {
      total: stories.length,
      counts: storyCounts,
    },
  };

  if (json) {
    console.log(JSON.stringify(status, null, 2));
    return;
  }

  console.log(chalk.bold(`\n📊 Team: ${team.name}\n`));
  console.log(chalk.gray(`Repository: ${team.repo_url}`));
  console.log(chalk.gray(`Path: ${team.repo_path}`));
  console.log();

  console.log(chalk.bold('Agents:'));
  if (activeAgents.length === 0) {
    console.log(chalk.gray('  No active agents'));
  } else {
    for (const agent of activeAgents) {
      let opusIndicator = '';
      if (agent.current_story_id) {
        const story = getStoryById(db, agent.current_story_id);
        if (story && story.requirement_id) {
          const requirement = getRequirementById(db, story.requirement_id);
          if (requirement?.godmode) {
            opusIndicator = chalk.yellow(' [Opus]');
          }
        }
      }
      const storyInfo = agent.current_story_id ? ` → ${agent.current_story_id}` : '';
      console.log(
        `  ${agent.id.padEnd(25)} ${agent.type.padEnd(12)} ${statusColor(agent.status)}${storyInfo}${opusIndicator}`
      );
    }
  }
  console.log();

  console.log(chalk.bold('Stories:'), stories.length);
  for (const [status, count] of Object.entries(storyCounts)) {
    console.log(`  ${status.padEnd(15)} ${count}`);
  }
}

function showStoryStatus(db: import('better-sqlite3').Database, storyId: string, json?: boolean): void {
  const story = getStoryById(db, storyId);
  if (!story) {
    console.error(chalk.red(`Story not found: ${storyId}`));
    process.exit(1);
  }

  const dependencies = getStoryDependencies(db, story.id);
  const logs = getLogsByStory(db, story.id).slice(0, 10);

  const status = {
    story: {
      id: story.id,
      title: story.title,
      description: story.description,
      status: story.status,
      complexity: story.complexity_score,
      points: story.story_points,
      assignedAgent: story.assigned_agent_id,
      branch: story.branch_name,
      prUrl: story.pr_url,
      acceptanceCriteria: story.acceptance_criteria ? JSON.parse(story.acceptance_criteria) : [],
    },
    dependencies: dependencies.map(d => ({ id: d.id, title: d.title, status: d.status })),
    recentLogs: logs.map(l => ({
      timestamp: l.timestamp,
      agent: l.agent_id,
      event: l.event_type,
      message: l.message,
    })),
  };

  if (json) {
    console.log(JSON.stringify(status, null, 2));
    return;
  }

  console.log(chalk.bold(`\n📋 Story: ${story.id}\n`));
  console.log(chalk.bold('Title:'), story.title);
  console.log(chalk.bold('Status:'), statusColor(story.status));
  console.log(chalk.bold('Description:'));
  console.log(chalk.gray(`  ${story.description}`));
  console.log();

  if (story.complexity_score) {
    console.log(chalk.bold('Complexity:'), story.complexity_score);
  }
  if (story.story_points) {
    console.log(chalk.bold('Story Points:'), story.story_points);
  }
  if (story.assigned_agent_id) {
    console.log(chalk.bold('Assigned To:'), story.assigned_agent_id);
  }
  if (story.branch_name) {
    console.log(chalk.bold('Branch:'), story.branch_name);
  }
  if (story.pr_url) {
    console.log(chalk.bold('PR:'), chalk.cyan(story.pr_url));
  }
  console.log();

  if (story.acceptance_criteria) {
    console.log(chalk.bold('Acceptance Criteria:'));
    const criteria = JSON.parse(story.acceptance_criteria) as string[];
    for (const c of criteria) {
      console.log(chalk.gray(`  • ${c}`));
    }
    console.log();
  }

  if (dependencies.length > 0) {
    console.log(chalk.bold('Dependencies:'));
    for (const dep of dependencies) {
      console.log(`  ${dep.id} - ${dep.title.substring(0, 40)}... - ${statusColor(dep.status)}`);
    }
    console.log();
  }

  if (logs.length > 0) {
    console.log(chalk.bold('Recent Activity:'));
    for (const log of logs) {
      const time = log.timestamp.substring(11, 19);
      const msg = log.message ? `: ${log.message.substring(0, 40)}` : '';
      console.log(chalk.gray(`  ${time} | ${log.agent_id.padEnd(15)} | ${log.event_type}${msg}`));
    }
  }
}
