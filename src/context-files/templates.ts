/**
 * Context File Templates
 *
 * CLI-specific templates for generating context files
 */

import {
  formatGitWorkflow,
  formatHiveMsgCommands,
  formatQualityChecks,
  formatStoriesForContext,
  getAgentRoleDescription,
} from './generator.js';
import type { ContextFileOptions } from './index.js';

/**
 * Template for Claude Code context file (CLAUDE.md)
 */
export function claudeCodeTemplate(options: ContextFileOptions): string {
  const { team, stories, agentType, config, agentId } = options;
  const formattedStories = formatStoriesForContext(stories);
  const agentRole = getAgentRoleDescription(agentType);
  const hiveMsgCommands = formatHiveMsgCommands(agentId);
  const gitWorkflow = formatGitWorkflow();
  const qualityChecks = formatQualityChecks(config.qa?.quality_checks || []);
  const buildCommand = config.qa?.build_command || 'npm run build';

  return `<!-- HIVE:START -->
# Hive Workflow Context - Claude Code

**Team**: ${team.name}
**Repository**: ${team.repo_path}
**Role**: ${agentRole}

## Your Assignment

You are part of the Hive orchestration system. This document contains the context you need to work effectively within the team.

${agentId ? `**Your Agent ID**: \`${agentId}\`` : ''}

## Active Stories

${formattedStories}

## Quality Standards

Before submitting work for review, ensure your code passes all quality checks:

### Quality Checks

${qualityChecks}

### Build Command

\`\`\`bash
${buildCommand}
\`\`\`

${
  config.qa?.test_command
    ? `### Test Command

\`\`\`bash
${config.qa.test_command}
\`\`\``
    : ''
}

## Development Workflow

${gitWorkflow}

${hiveMsgCommands}

## Story Implementation Process

1. **Select a story** - Your senior will assign stories to you
2. **Create feature branch** - Name it \`feature/<story-id>-<short-description>\`
3. **Implement changes** - Write clean, tested code following existing patterns
4. **Run quality checks** - Execute all quality checks before committing
5. **Commit regularly** - Keep commits small and focused
6. **Push and create PR** - Push your branch and create a pull request on GitHub
7. **Review feedback** - Address code review comments promptly
8. **Merge** - Once approved and all checks pass, the story will be merged

## Important Notes

- Always ask for help if you're stuck (use \`hive msg\`)
- Run tests locally before pushing
- Keep your branch up to date with main
- Link stories to PRs using the story ID in the PR description
- Follow the existing code patterns and conventions in the repository
- If you discover a useful fix outside the current story scope, do not expand the current branch; create a separate refactor story using context from the code you already read

## Escalation

If you encounter blockers that you cannot resolve:
1. Document what you've tried
2. Message your Senior using \`hive msg\`
3. Wait for guidance before proceeding further

---
<!-- HIVE:END -->`;
}

/**
 * Template for Codex context file (AGENTS.md)
 */
export function codexTemplate(options: ContextFileOptions): string {
  const { team, stories, agentType, config, agentId } = options;
  const formattedStories = formatStoriesForContext(stories);
  const agentRole = getAgentRoleDescription(agentType);
  const hiveMsgCommands = formatHiveMsgCommands(agentId);
  const gitWorkflow = formatGitWorkflow();
  const qualityChecks = formatQualityChecks(config.qa?.quality_checks || []);
  const buildCommand = config.qa?.build_command || 'npm run build';

  return `<!-- HIVE:START -->
# Hive Team Context - Codex Agent

**Team**: ${team.name}
**Repository Path**: ${team.repo_path}
**Agent Role**: ${agentRole}

## Team Assignment Overview

This file contains essential information for working within the Hive orchestration system using Codex CLI.

${agentId ? `**Agent Identifier**: \`${agentId}\`` : ''}

## Current Work Items

${formattedStories}

## Code Quality Requirements

All code must pass the following quality checks before submission:

### Quality Assurance Checks

${qualityChecks}

### Build Process

\`\`\`bash
${buildCommand}
\`\`\`

${
  config.qa?.test_command
    ? `### Test Suite

\`\`\`bash
${config.qa.test_command}
\`\`\``
    : ''
}

## Implementation Standards

${gitWorkflow}

${hiveMsgCommands}

## Story Delivery Pipeline

1. **Story Assignment** - Your team lead assigns stories based on complexity
2. **Branch Creation** - Create branches named \`feature/<story-id>-<feature-name>\`
3. **Code Development** - Implement features following team conventions
4. **Quality Assurance** - Run all quality checks and verify the build succeeds
5. **Commit Management** - Make focused commits with clear messages
6. **Push and PR** - Push your branch and open a GitHub pull request
7. **Code Review** - Respond to review comments and refine as needed
8. **Merge Process** - Once approved, code is merged to main branch

## Best Practices

- Always verify quality checks pass before pushing
- Test all changes locally
- Maintain branch freshness - rebase on main regularly
- Link PRs to stories using story identifiers
- Follow established code patterns and conventions
- Document non-obvious implementation decisions
- If you discover a useful fix outside the current story scope, do not expand the current branch; create a separate refactor story using context from the code you already read

## Getting Help

If you need assistance:
1. Clearly document any blockers
2. Use \`hive msg send\` to contact your team lead or senior
3. Provide context about what you've already tried
4. Wait for guidance before making workarounds

---
<!-- HIVE:END -->`;
}

/**
 * Template for Gemini context file (GEMINI.md)
 */
export function geminiTemplate(options: ContextFileOptions): string {
  const { team, stories, agentType, config, agentId } = options;
  const formattedStories = formatStoriesForContext(stories);
  const agentRole = getAgentRoleDescription(agentType);
  const hiveMsgCommands = formatHiveMsgCommands(agentId);
  const gitWorkflow = formatGitWorkflow();
  const qualityChecks = formatQualityChecks(config.qa?.quality_checks || []);
  const buildCommand = config.qa?.build_command || 'npm run build';

  return `<!-- HIVE:START -->
# Hive Development Context - Gemini

**Team Assignment**: ${team.name}
**Repository**: ${team.repo_path}
**Position**: ${agentRole}

## Hive Context Document

This document provides all necessary context for your work as a Hive agent.

${agentId ? `**Agent ID**: \`${agentId}\`` : ''}

## Assigned Stories

${formattedStories}

## Code Quality Standards

Your code must meet these quality standards before final submission:

### Validation Checks

${qualityChecks}

### Build Verification

\`\`\`bash
${buildCommand}
\`\`\`

${
  config.qa?.test_command
    ? `### Testing

\`\`\`bash
${config.qa.test_command}
\`\`\``
    : ''
}

## Development Process

${gitWorkflow}

${hiveMsgCommands}

## Workflow for Story Completion

1. **Receive Assignment** - Your manager assigns stories matched to your skills
2. **Setup Branch** - Initialize feature branch: \`feature/<story-id>-<brief-title>\`
3. **Implementation** - Develop the feature with attention to quality
4. **Validation** - Confirm all quality checks and builds pass
5. **Save Changes** - Commit your work with meaningful messages
6. **Upload Work** - Push branch and create pull request on GitHub
7. **Handle Feedback** - Address review comments and iterate
8. **Complete** - Story is merged once all approvals obtained

## Quality Standards

- Always run quality checks locally before pushing
- Verify the build completes successfully
- Run tests to catch regressions
- Use story IDs in PR references for tracking
- Maintain consistency with existing codebase
- Comment complex logic
- If you discover a useful fix outside the current story scope, do not expand the current branch; create a separate refactor story using context from the code you already read

## Support and Escalation

When you encounter issues:
1. Document what you've investigated
2. Send a message to your team lead: \`hive msg send hive-senior-${team.name} "your question"\`
3. Include details of what you've tried
4. Await direction before implementing workarounds

---
<!-- HIVE:END -->`;
}
