/**
 * Context File Content Generator
 *
 * Generates the actual content for context files based on CLI tool type
 */
import { claudeCodeTemplate, codexTemplate, geminiTemplate } from './templates.js';
/**
 * Generate context file content for the specified CLI tool
 */
export function generateContextFileContent(options) {
    const { cliTool } = options;
    // Get the appropriate template for the CLI tool
    let template;
    switch (cliTool) {
        case 'claude-code':
            template = claudeCodeTemplate;
            break;
        case 'codex':
            template = codexTemplate;
            break;
        case 'gemini':
            template = geminiTemplate;
            break;
        default:
            throw new Error(`Unsupported CLI tool: ${cliTool}`);
    }
    return template(options);
}
/**
 * Format stories for display in context files
 */
export function formatStoriesForContext(stories) {
    if (stories.length === 0) {
        return 'No active stories';
    }
    return stories
        .map(story => `
### ${story.id}: ${story.title}
- **Status**: ${story.status}
- **Complexity**: ${story.complexity_score || 'Not estimated'}
- **Story Points**: ${story.story_points || 'Not estimated'}
- **Description**: ${story.description}
${story.acceptance_criteria && story.acceptance_criteria.length > 0
        ? `**Acceptance Criteria**:\n${(Array.isArray(story.acceptance_criteria) ? story.acceptance_criteria : JSON.parse(story.acceptance_criteria || '[]')).map((c) => `  - ${c}`).join('\n')}`
        : ''}`)
        .join('\n\n');
}
/**
 * Format quality check commands for display
 */
export function formatQualityChecks(commands) {
    return commands.map(cmd => `\`${cmd}\``).join('\n');
}
/**
 * Format agent role description
 */
export function getAgentRoleDescription(agentType) {
    switch (agentType) {
        case 'tech_lead':
            return 'Tech Lead - Orchestrates multiple teams, manages cross-repo dependencies, and escalation endpoint';
        case 'senior':
            return 'Senior Developer - Team lead, estimates complexity, delegates work, reviews code';
        case 'intermediate':
            return 'Intermediate Developer - Handles moderate complexity tasks, works on delegated stories';
        case 'junior':
            return 'Junior Developer - Works on simple tasks under senior guidance, learns from code reviews';
        case 'qa':
            return 'QA Agent - Runs quality checks, builds, and validates code before PR submission';
        default:
            return `${agentType} Agent`;
    }
}
/**
 * Format hive msg command examples
 */
export function formatHiveMsgCommands(agentId) {
    return `
## Communication with Hive Team

Use \`hive msg\` to communicate with other team members:

\`\`\`bash
# Send a message to your senior
hive msg send hive-senior-<team> "Your question here"

# Send a message to the tech lead
hive msg send hive-tech-lead "Your question here"

# Check your inbox
hive msg inbox ${agentId || 'your-agent-id'}

# Reply to a message
hive msg reply <msg-id> "Your response here"
\`\`\`

${agentId ? `**Your Agent ID**: \`${agentId}\`` : ''}
`;
}
/**
 * Format git workflow instructions
 */
export function formatGitWorkflow() {
    return `
## Git Workflow

1. **Create feature branch**: \`git checkout -b feature/<story-id>-<description>\`
2. **Commit changes**: \`git commit -m "<message>"\` with clear, focused messages
3. **Keep commits clean**: One logical change per commit
4. **Push regularly**: \`git push origin feature/<story-id>-<description>\`
5. **Create PR**: Use GitHub to create a PR with story ID in title
6. **Link to story**: Include story ID in PR description for tracking

### Naming Conventions

- **Branches**: \`feature/STORY-123-short-description\`
- **Commits**: \`STORY-123: Brief description of what changed\`
- **PR Titles**: \`Story STORY-123: Feature title\`
`;
}
//# sourceMappingURL=generator.js.map