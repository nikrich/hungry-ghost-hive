// Licensed under the Hungry Ghost Hive License. See LICENSE.

import chalk from 'chalk';
import { getCliRuntimeBuilder, resolveRuntimeModelForCli } from '../../../cli-runtimes/index.js';
import { loadConfig } from '../../../config/loader.js';
import { getAgentsByType, updateAgent } from '../../../db/queries/agents.js';
import { createLog } from '../../../db/queries/logs.js';
import { getRequirementsByStatus } from '../../../db/queries/requirements.js';
import { getAllTeams } from '../../../db/queries/teams.js';
import { AgentState } from '../../../state-detectors/types.js';
import {
  captureTmuxPane,
  isTmuxSessionRunning,
  killTmuxSession,
  spawnTmuxSession,
} from '../../../tmux/manager.js';
import type { CLITool } from '../../../utils/cli-commands.js';
import { getTechLeadSessionName } from '../../../utils/instance.js';
import { findHiveRoot as findHiveRootFromDir, getHivePaths } from '../../../utils/paths.js';
import { generateTechLeadPrompt } from '../req.js';
import { detectAgentState } from './agent-monitoring.js';
import { verboseLogCtx } from './manager-utils.js';
import { isTechLeadRestartOnCooldown } from './restart-cooldown.js';
import type { ManagerCheckContext } from './types.js';
import { TMUX_CAPTURE_LINES_SHORT } from './types.js';

const techLeadLastRestartByAgentId = new Map<string, number>();

export async function restartStaleTechLead(ctx: ManagerCheckContext): Promise<void> {
  const maxAgeHours = ctx.config.manager.tech_lead_max_age_hours;
  const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
  const now = Date.now();

  // Phase 1: Read tech lead agents (brief lock)
  const techLeads = await ctx.withDb(async db => {
    const leads = getAgentsByType(db.db, 'tech_lead');
    verboseLogCtx(ctx, `restartStaleTechLead: found ${leads.length} tech lead agent(s)`);
    return leads.map(tl => ({
      id: tl.id,
      tmuxSession: tl.tmux_session,
      cliTool: (tl.cli_tool || 'claude') as CLITool,
      createdAt: tl.created_at,
    }));
  });

  // Phase 2: Check sessions and restart (tmux I/O outside lock, DB writes under brief lock)
  for (const techLead of techLeads) {
    if (!techLead.tmuxSession) {
      verboseLogCtx(ctx, `restartStaleTechLead: techLead=${techLead.id} skip=no_tmux_session`);
      continue;
    }

    const sessionRunning = await isTmuxSessionRunning(techLead.tmuxSession);
    if (!sessionRunning) {
      verboseLogCtx(
        ctx,
        `restartStaleTechLead: techLead=${techLead.id} skip=session_not_running session=${techLead.tmuxSession}`
      );
      continue;
    }

    const createdAt = new Date(techLead.createdAt).getTime();
    const ageMs = now - createdAt;
    const ageHours = ageMs / (60 * 60 * 1000);

    verboseLogCtx(
      ctx,
      `restartStaleTechLead: techLead=${techLead.id} age=${ageHours.toFixed(2)}h threshold=${maxAgeHours}h`
    );

    if (ageMs < maxAgeMs) {
      verboseLogCtx(
        ctx,
        `restartStaleTechLead: techLead=${techLead.id} skip=not_stale remainingMs=${maxAgeMs - ageMs}`
      );
      continue;
    }

    const cooldown = isTechLeadRestartOnCooldown(
      techLeadLastRestartByAgentId.get(techLead.id),
      now,
      maxAgeHours
    );
    if (cooldown.onCooldown) {
      verboseLogCtx(
        ctx,
        `restartStaleTechLead: techLead=${techLead.id} skip=cooldown cooldownHours=${cooldown.cooldownHours} remainingMs=${cooldown.remainingMs}`
      );
      continue;
    }

    const output = await captureTmuxPane(techLead.tmuxSession, TMUX_CAPTURE_LINES_SHORT);
    const stateResult = detectAgentState(output, techLead.cliTool);

    verboseLogCtx(
      ctx,
      `restartStaleTechLead: techLead=${techLead.id} state=${stateResult.state} waiting=${stateResult.isWaiting} needsHuman=${stateResult.needsHuman}`
    );

    if (
      !stateResult.isWaiting ||
      stateResult.needsHuman ||
      stateResult.state === AgentState.THINKING
    ) {
      verboseLogCtx(
        ctx,
        `restartStaleTechLead: techLead=${techLead.id} skip=not_safe_state state=${stateResult.state}`
      );
      continue;
    }

    verboseLogCtx(
      ctx,
      `restartStaleTechLead: techLead=${techLead.id} action=restarting session=${techLead.tmuxSession}`
    );

    // Kill the existing session (tmux I/O, no lock)
    await killTmuxSession(techLead.tmuxSession);

    // Spawn a new session with the same configuration (tmux I/O, no lock)
    const hiveRoot = findHiveRootFromDir(ctx.root);
    if (!hiveRoot) {
      verboseLogCtx(ctx, `restartStaleTechLead: techLead=${techLead.id} error=hive_root_not_found`);
      continue;
    }

    const paths = getHivePaths(hiveRoot);
    const config = loadConfig(paths.hiveDir);
    const agentConfig = config.models.tech_lead;
    const cliTool = agentConfig.cli_tool;
    const safetyMode = agentConfig.safety_mode;
    const model = resolveRuntimeModelForCli(agentConfig.model, cliTool);

    const chromeEnabled = config.agents?.chrome_enabled === true && cliTool === 'claude';
    const runtimeBuilder = getCliRuntimeBuilder(cliTool);
    const commandArgs = runtimeBuilder.buildSpawnCommand(model, safetyMode, {
      chrome: chromeEnabled,
    });

    // Look up active requirement and teams to provide context to the restarted tech lead
    const initialPrompt = await ctx.withDb(async db => {
      const planningReqs = getRequirementsByStatus(db.db, 'planning');
      const inProgressReqs = getRequirementsByStatus(db.db, 'in_progress');
      const activeReq = planningReqs[0] ?? inProgressReqs[0] ?? null;
      const teams = getAllTeams(db.db);

      if (activeReq) {
        return generateTechLeadPrompt(
          activeReq.id,
          activeReq.title,
          activeReq.description,
          teams,
          activeReq.godmode === 1,
          activeReq.target_branch || 'main',
          getTechLeadSessionName(paths.hiveDir)
        );
      }

      const techLeadInbox = getTechLeadSessionName(paths.hiveDir);
      return `You are the Tech Lead of Hive, an AI development team orchestrator.

You have been restarted to refresh your context. No active requirement is currently being planned.

## Next Steps

1. Check the current status of the Hive workspace:
\`\`\`bash
hive status
\`\`\`

2. Check your inbox for messages from developers:
\`\`\`bash
hive msg inbox ${techLeadInbox}
\`\`\`

3. If there are pending requirements, begin planning them. If all work is complete, monitor for new requirements.`;
    });

    await spawnTmuxSession({
      sessionName: techLead.tmuxSession,
      workDir: ctx.root,
      commandArgs,
      initialPrompt,
    });

    // DB writes under brief lock
    await ctx.withDb(async db => {
      createLog(db.db, {
        agentId: 'manager',
        eventType: 'AGENT_SPAWNED',
        status: 'info',
        message: `Tech lead ${techLead.id} restarted for context freshness (age: ${ageHours.toFixed(1)}h)`,
        metadata: {
          agent_id: techLead.id,
          tmux_session: techLead.tmuxSession,
          age_hours: ageHours,
          threshold_hours: maxAgeHours,
          restart_reason: 'context_freshness',
        },
      });
      updateAgent(db.db, techLead.id, {
        status: 'working',
        createdAt: new Date().toISOString(),
      });
      db.save();
    });

    techLeadLastRestartByAgentId.set(techLead.id, now);

    console.log(
      chalk.green(
        `  Tech lead ${techLead.id} restarted for context freshness (age: ${ageHours.toFixed(1)}h)`
      )
    );
  }
}
