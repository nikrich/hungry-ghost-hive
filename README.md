# Hive - AI Agent Orchestrator

<img width="1263" height="651" alt="image" src="https://github.com/user-attachments/assets/76eb8bd9-d5ec-45b7-9ee2-b7ef910f3e88" />

Hive is a CLI tool that orchestrates AI agents modeled after agile software development teams. You act as the **Product Owner**, providing requirements. Hive's AI agents handle the rest—from planning through to PR submission.

## Installation

### Via npm (Recommended)

```bash
npm install -g hungry-ghost-hive
```

### For Contributors (Development Setup)

#### Prerequisites

Before setting up the development environment, ensure you have:

- **Node.js 20.x or higher** (check with `node --version`)
  - Recommended: Node 20.x LTS or latest stable
  - Minimum: Node 18.x (see `engines` in package.json)
- **npm 10.x or higher** (comes with Node.js)
- **Git 2.x or higher** (check with `git --version`)
- **tmux 3.x or higher** (required for agent sessions, check with `tmux -V`)
  - On macOS: `brew install tmux`
  - On Ubuntu/Debian: `sudo apt-get install tmux`
  - On other systems: [https://github.com/tmux/tmux/wiki/Installing](https://github.com/tmux/tmux/wiki/Installing)
- **Bash or Zsh shell** (for tmux session management)

#### Environment Variables

Create a `.env` file in the project root or export in your shell:

```bash
# Required for Claude agents
export ANTHROPIC_API_KEY="sk-ant-..."

# Required for GPT-based agents
export OPENAI_API_KEY="sk-..."

# Required for GitHub PR creation and actions
export GITHUB_TOKEN="ghp_..."
```

Alternatively, add these to your shell profile (`.bashrc`, `.zshrc`, etc.) for persistence.

#### Installation Steps

```bash
# Clone the repository
git clone https://github.com/nikrich/hungry-ghost-hive.git
cd hungry-ghost-hive

# Install dependencies (uses npm ci for reproducible builds)
npm ci

# Build the TypeScript project
npm run build

# Create a symlink for global access (optional, for development)
npm link

# Verify installation
hive --version
hive --help
```

#### Development Workflow

For development with TypeScript compilation watching:

```bash
# Run in development mode with tsx (faster builds than npm run build)
npm run dev

# In another terminal, watch and rebuild on changes
npm run build  # or use a TypeScript watcher
```

## Quick Start

```bash
# Initialize a workspace
hive init

# Add a repository with a team
hive add-repo --url git@github.com:org/my-service.git --team my-team

# Submit a requirement (this kicks off the entire workflow)
hive req "Add user authentication with OAuth2 support"

# Watch the magic happen
hive dashboard
```

### Basic Usage Examples

After installation, you can:

```bash
# Check overall status
hive status

# View all stories
hive stories list

# Check your team's active agents
hive agents list --active

# Monitor progress in real-time
hive dashboard

# Check for escalations (agents asking for help)
hive escalations list
```

## Testing

### Running Tests

The project uses [Vitest](https://vitest.dev/) for testing.

```bash
# Run all tests once
npm test

# Run tests in watch mode (reruns on file changes)
npm run test:watch

# Run specific test file
npm test src/config/schema.test.ts

# Run tests matching a pattern
npm test -- --grep "config"
```

### Code Quality Checks

Before committing code, verify quality:

```bash
# Type checking (no compilation)
npm run type-check

# Linting with ESLint
npm run lint

# Full build (TypeScript compilation)
npm run build
```

### Pre-commit Hooks

The repository uses Husky and commitlint for automated quality checks. When you commit:

1. Husky runs pre-commit hooks
2. Code is linted and type-checked
3. Conventional commit format is enforced

If a commit fails checks, fix the issues and try again:

```bash
# Fix linting issues
npm run lint  # See what's wrong
# Fix manually or with eslint --fix

# Then retry your commit
git add .
git commit -m "your message"
```

### Continuous Integration

The CI pipeline (GitHub Actions) runs on every push and PR:
- Node.js 20.x
- Build: `npm run build`
- Type check: `npm run type-check`
- Lint: `npm run lint`
- Tests: `npm test`

All checks must pass before merging.

## How It Works

### Your Role: Product Owner

You provide high-level requirements. The AI team handles everything else:

```
┌─────────────────────────────────────────────────────────────┐
│                    YOU (Product Owner)                       │
│              "Add feature X to the system"                   │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│                  TECH LEAD (Claude Opus)                     │
│  • Analyzes your requirement                                 │
│  • Breaks it into stories                                    │
│  • Coordinates teams                                         │
└─────────────────────┬───────────────────────────────────────┘
                      │
          ┌───────────┴───────────┐
          ▼                       ▼
┌─────────────────┐     ┌─────────────────┐
│   TEAM: Alpha    │     │   TEAM: Beta     │
│                  │     │                  │
│ Senior (Sonnet)  │     │ Senior (Sonnet)  │
│      │           │     │      │           │
│  ┌───┴───┐       │     │  ┌───┴───┐       │
│  Int   Jr        │     │  Int   Jr        │
│                  │     │                  │
│ QA (Sonnet)      │     │ QA (Sonnet)      │
└─────────────────┘     └─────────────────┘
```

### The Workflow

1. **You submit a requirement** → `hive req "Your feature request"`
2. **Tech Lead analyzes** → Identifies affected repos, creates stories
3. **Seniors estimate** → Assign complexity scores, plan the work
4. **Work is assigned** → Based on complexity:
   - Simple (1-3 points) → Junior
   - Medium (4-5 points) → Intermediate
   - Complex (6-13 points) → Senior
5. **Developers implement** → Create branches, write code, run tests
6. **PRs submitted** → `hive pr submit` adds to merge queue
7. **QA reviews** → Automated spawning, code review, approval
8. **Merged!** → Story complete

### The Manager (Micromanager Daemon)

The Manager ensures agents stay productive:

- **Auto-starts** when work begins
- **Checks every 60 seconds** for stuck agents
- **Health checks** sync agent status with tmux sessions
- **Nudges idle agents** to check for work
- **Forwards messages** between agents
- **Spawns QA** when PRs need review

## Commands Reference

### For You (Product Owner)

```bash
# Submit a new requirement
hive req "Implement user authentication"
hive req --file requirements.md

# Check overall status
hive status

# Open the dashboard
hive dashboard

# Dashboard controls:
#   ↑↓        Navigate agents list
#   Enter     Attach to selected agent's tmux session
#   Ctrl+B,D  Detach from tmux (returns to shell)
#   Tab       Switch between panels
#   Esc/Q     Exit dashboard

# View escalations (agents asking for help)
hive escalations list
hive escalations resolve <id> --message "Here's what to do..."
```

### Workflow Management

```bash
# Assign stories to agents (triggers work)
hive assign

# View stories
hive stories list
hive stories show <story-id>

# View agents
hive agents list
hive agents list --active
```

### Merge Queue & QA

```bash
# View the merge queue
hive pr queue

# Manually trigger QA review
hive pr review --from <qa-session>

# Approve/reject PRs
hive pr approve <pr-id>
hive pr reject <pr-id> --reason "Tests failing"
```

### Manager (Micromanager)

```bash
# Check manager status
hive manager status

# Manually start/stop
hive manager start
hive manager start -i 30  # Check every 30 seconds
hive manager stop

# Run single check
hive manager check

# Sync agent status with tmux
hive manager health

# Nudge a specific agent
hive manager nudge <session>
hive manager nudge hive-senior-alpha -m "Check the failing tests"
```

### Communication

```bash
# Send message to an agent
hive msg send hive-senior-alpha "Please prioritize STORY-001"

# Check messages
hive msg inbox
hive msg outbox
```

## Architecture

### Directory Structure

```
my-workspace/
├── .hive/
│   ├── hive.db              # SQLite database (all state)
│   ├── hive.config.yaml     # Configuration
│   ├── agents/              # Agent session states
│   └── logs/                # Conversation logs
├── repos/
│   ├── service-a/           # Git submodule
│   └── service-b/           # Git submodule
└── README.md
```

### Agent Sessions

Each agent runs in a tmux session:

```
hive-tech-lead          # Tech Lead (Opus)
hive-senior-alpha       # Senior for team "alpha"
hive-intermediate-alpha-1
hive-junior-alpha-1
hive-qa-alpha           # QA for team "alpha"
hive-manager            # The micromanager daemon
```

### Story States

```
draft → estimated → planned → in_progress → review → qa → pr_submitted → merged
                                              ↓
                                          qa_failed (returns to developer)
```

## Configuration

Edit `.hive/hive.config.yaml`:

```yaml
# Model assignments
models:
  tech_lead:
    provider: anthropic
    model: claude-opus-4-20250514
  senior:
    provider: anthropic
    model: claude-sonnet-4-20250514
  intermediate:
    provider: anthropic
    model: claude-haiku-3-5-20241022
  junior:
    provider: openai
    model: gpt-4o-mini
  qa:
    provider: anthropic
    model: claude-sonnet-4-20250514

# Complexity thresholds for delegation
scaling:
  junior_max_complexity: 3      # 1-3 → Junior
  intermediate_max_complexity: 5 # 4-5 → Intermediate
  senior_capacity: 20           # Story points before scaling up

# QA checks
qa:
  quality_checks:
    - npm run lint
    - npm run type-check
  build_command: npm run build
  test_command: npm test
```

## Escalation Protocol

When agents get stuck, they escalate:

```
Junior → Senior → Tech Lead → YOU
```

Check escalations:
```bash
hive escalations list
```

Resolve with guidance:
```bash
hive escalations resolve ESC-001 --message "Use OAuth2 with PKCE flow"
```

## Tips for Product Owners

1. **Be specific in requirements** - The more detail, the better the stories
2. **Check the dashboard** - `hive dashboard` shows real-time progress
3. **Monitor escalations** - Agents will ask when they need guidance
4. **Trust the process** - Let agents work, they'll handle the details

## Troubleshooting

### Setup Issues

**Installation fails with Node version error**
```bash
# Check your Node version
node --version  # Should be 20.x or higher

# If too old, upgrade Node.js
# macOS (using Homebrew)
brew install node@20

# Or use nvm (Node Version Manager)
nvm install 20
nvm use 20
```

**tmux not found or incompatible**
```bash
# Check tmux version
tmux -V  # Should be 3.x or higher

# Install or upgrade tmux
# macOS
brew install tmux
# or
brew upgrade tmux

# Ubuntu/Debian
sudo apt-get install tmux
```

**npm ci fails with permission errors**
```bash
# Clear npm cache
npm cache clean --force

# Reinstall dependencies
npm ci

# If still failing, try
rm -rf node_modules package-lock.json
npm install
```

### Runtime Issues

**Agents seem stuck or not progressing**
```bash
# Check if manager is running
hive manager status

# Nudge all agents to check for work
hive manager check

# Sync agent status with tmux sessions (cleans up dead sessions)
hive manager health

# Manually start the manager
hive manager start
```

**Agent session died or became unresponsive**
```bash
# Automatically clean up dead sessions and respawn as needed
hive manager health

# Or manually restart the manager
hive manager stop
hive manager start
```

**Cannot connect to an agent's tmux session**
```bash
# List all tmux sessions
tmux list-sessions

# Attach to a specific agent session
tmux attach -t hive-senior-alpha
# Or: tmux attach -t hive-junior-beta-1

# Detach from the session (without terminating it)
# Press: Ctrl+B, D

# Kill a specific session if needed
tmux kill-session -t hive-junior-alpha-1
```

**Environment variables not being recognized**
```bash
# Verify variables are set
echo $ANTHROPIC_API_KEY
echo $GITHUB_TOKEN

# If empty, export them
export ANTHROPIC_API_KEY="sk-ant-..."
export GITHUB_TOKEN="ghp_..."

# Or add to ~/.bashrc or ~/.zshrc for persistence
echo 'export ANTHROPIC_API_KEY="..."' >> ~/.bashrc
source ~/.bashrc
```

### Database & State Issues

**Database is corrupted or in a bad state**
```bash
# View database location (in your workspace)
# Usually at: ~/.hive/hive.db

# Backup the database first
cp ~/.hive/hive.db ~/.hive/hive.db.backup

# Reset everything (WARNING: Irreversible)
hive nuke --all

# Reinitialize
hive init
```

**Workspace not found or inaccessible**
```bash
# Ensure you're in the correct directory
pwd

# Verify .hive directory exists
ls -la .hive/

# Check permissions
ls -ld .hive/
chmod 755 .hive/
```

### Testing & Build Issues

**Tests failing unexpectedly**
```bash
# Ensure Node version is correct
node --version

# Clear dependencies and reinstall
rm -rf node_modules
npm ci

# Run tests with verbose output
npm test -- --reporter=verbose

# Run specific test file to isolate issues
npm test src/config/schema.test.ts
```

**Build fails with TypeScript errors**
```bash
# Check for type errors
npm run type-check

# Try rebuilding from scratch
rm -rf dist
npm run build

# Check for linting issues
npm run lint
```

**Linting issues blocking commits**
```bash
# See all linting errors
npm run lint

# Automatically fix fixable issues
npm run lint -- --fix

# Then commit your changes
git add .
git commit -m "your message"
```

### Git & PR Issues

**Cannot create a PR (GitHub token issues)**
```bash
# Verify GitHub token is set
echo $GITHUB_TOKEN

# Create a new token if needed
# https://github.com/settings/tokens/new
# Required scopes: repo, workflow

# Export the token
export GITHUB_TOKEN="ghp_..."
```

**Merge conflicts when pulling from main**
```bash
# Abort the merge if needed
git merge --abort

# Pull with rebase instead
git pull --rebase origin main

# If conflicts remain, resolve them manually
git status  # See conflicted files
# Edit files, then:
git add .
git rebase --continue
```

### Getting Help

If you're still stuck:

1. **Check the logs**
   ```bash
   # Agent conversation logs
   ls -la .hive/logs/

   # View specific agent log
   cat .hive/logs/hive-senior-alpha.log
   ```

2. **View configuration**
   ```bash
   cat .hive/hive.config.yaml
   ```

3. **Report an issue**
   - GitHub Issues: https://github.com/nikrich/hungry-ghost-hive/issues
   - Include: Node version, tmux version, error messages, recent logs

## Environment Variables

```bash
ANTHROPIC_API_KEY=sk-ant-...  # Required for Claude agents
OPENAI_API_KEY=sk-...         # Required for GPT agents (juniors)
GITHUB_TOKEN=ghp_...          # Required for PR creation
```

## Issue Tracking (Beads)

This repository uses `bd` (Beads) for issue tracking. Run `bd onboard` to get started.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --status in_progress  # Claim work
bd close <id>         # Complete work
bd sync               # Sync with git
```

### Session Completion (Landing the Plane)

When ending a work session, complete ALL steps below. Work is NOT complete until `git push` succeeds.

1. File issues for remaining work
2. Run quality gates (tests/linters/builds) if code changed
3. Update issue status (close finished work, update in-progress)
4. Push to remote:

```bash
git pull --rebase
bd sync
git push
git status  # MUST show "up to date with origin"
```

5. Clean up (stashes, prune remote branches)
6. Verify all changes committed AND pushed
7. Hand off with context for next session

## Glossary

### Core Concepts

**Agent**
An AI-powered team member (Claude, GPT, etc.) that works autonomously on assigned tasks. Each agent has a specific role (Senior, Intermediate, Junior, QA, Tech Lead) and runs in its own tmux session.

**Story**
A discrete unit of work broken down by the Tech Lead. Stories have complexity ratings (1-13 points) and are assigned to developers based on their level. Examples: "Implement user authentication", "Fix login bug".

**Complexity (Story Points)**
A measure of task difficulty:
- **1-3 points**: Junior developer work
- **4-5 points**: Intermediate developer work
- **6-13+ points**: Senior developer work
- Helps with capacity planning and workload distribution

**Requirement**
A high-level user request submitted to the system. The Tech Lead analyzes requirements and breaks them into stories. Example: "Add OAuth2 authentication to the system".

**PR (Pull Request)**
A GitHub pull request containing code changes. Created by developers, reviewed by QA agents, and merged when approved.

**Merge Queue**
A queue of PRs waiting for QA review and approval. The Manager tracks PR status and spawns QA agents as needed.

### Team Roles

**Product Owner (You)**
Submits requirements and guides the team. You monitor progress via the dashboard and resolve escalations.

**Tech Lead**
Senior AI agent (Claude Opus) that:
- Analyzes requirements
- Breaks work into stories
- Coordinates across teams
- Resolves complex escalations

**Senior Developer**
Mid-tier AI agent (Claude Sonnet) that:
- Estimates story complexity
- Plans implementation approach
- Mentors Intermediate and Junior developers
- Handles complex technical decisions

**Intermediate Developer**
Entry-level AI agent (Claude Haiku) that:
- Implements medium-complexity stories (4-5 points)
- Writes code and tests
- Escalates to Senior when stuck

**Junior Developer**
Trainee AI agent (GPT-4 mini) that:
- Implements simple stories (1-3 points)
- Writes basic code
- Learns from Senior feedback

**QA Agent**
Quality assurance AI agent (Claude Sonnet) that:
- Reviews code
- Runs tests and checks
- Validates PR quality
- Approves or rejects PRs

**Manager (Micromanager)**
Daemon process that:
- Monitors agent health
- Nudges idle agents
- Spawns QA agents when PRs are ready
- Forwards messages between agents
- Manages the merge queue

### Workflow States

**Draft**
Initial story state, being prepared by Tech Lead.

**Estimated**
Story has been reviewed by Senior for complexity and feasibility.

**Planned**
Senior has created an implementation plan.

**In Progress**
Developer is actively working on the story.

**Review**
Code is ready for peer/QA review.

**QA**
Quality assurance agents are testing the PR.

**QA Failed**
QA found issues; PR returns to developer.

**PR Submitted**
PR is in the merge queue awaiting final approval.

**Merged**
PR has been merged to main; story is complete.

### Technical Terms

**tmux**
Terminal multiplexer that allows multiple sessions to run simultaneously. Each agent runs in its own tmux session. Used for real-time monitoring and interaction.

**Story State Database**
SQLite database (`hive.db`) that tracks all story states, agent assignments, and workflow history.

**Escalation**
When an agent gets stuck and needs help:
- Junior → Senior
- Senior → Tech Lead
- Tech Lead → Product Owner

**Message Queue**
System for asynchronous communication between agents. Agents can send messages and check their inbox.

**Complexity Scaling**
Automatic workload distribution based on story complexity and agent capacity. Ensures work is matched to appropriate skill levels.

**Configuration (hive.config.yaml)**
YAML file that defines:
- AI model assignments for each role
- Complexity thresholds
- QA check commands
- Build and test commands

### Tools & Technologies

**CLI**
Command-line interface. The main way to interact with Hive system. Commands start with `hive`.

**GitHub**
Repository hosting and PR management platform. Hive creates PRs and manages code reviews via GitHub.

**tmux Sessions**
Named terminal sessions where agents run. Format: `hive-<role>-<team>-<instance>`. Example: `hive-senior-alpha`, `hive-junior-beta-1`.

**Dashboard**
Real-time TUI (Terminal User Interface) showing agent activity, story progress, and system status.

**Vitest**
Testing framework used for unit tests. Runs with `npm test`.

**ESLint**
Code linting tool that enforces code quality and style. Configured in `eslint.config.js`.

**TypeScript**
Strongly-typed JavaScript. Source code in `src/`, compiled to `dist/`.

**Beads (bd)**
Issue tracking tool. Complementary to story-based workflow for smaller tasks and bugs.

## License

MIT
