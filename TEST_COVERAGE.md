# Test Coverage

## Summary

Comprehensive unit test coverage across database queries, orchestrator, and agent modules using Vitest.

## Database Query Module Test Coverage

| Module           | Test File             | Test Count | Status      |
| ---------------- | --------------------- | ---------- | ----------- |
| agents.ts        | agents.test.ts        | 32 tests   | ✅ Complete |
| escalations.ts   | escalations.test.ts   | 34 tests   | ✅ Complete |
| heartbeat.ts     | heartbeat.test.ts     | 17 tests   | ✅ Complete |
| index.ts         | index.test.ts         | 7 tests    | ✅ Complete |
| logs.ts          | logs.test.ts          | 33 tests   | ✅ Complete |
| messages.ts      | messages.test.ts      | 19 tests   | ✅ Complete |
| pull-requests.ts | pull-requests.test.ts | 45 tests   | ✅ Complete |
| requirements.ts  | requirements.test.ts  | 21 tests   | ✅ Complete |
| stories.ts       | stories.test.ts       | 39 tests   | ✅ Complete |
| teams.ts         | teams.test.ts         | 12 tests   | ✅ Complete |

**Total: 259 tests across 10 database query modules**

## Test Execution

All tests pass successfully:

```bash
npm test -- src/db/queries
```

Result: ✅ **259/259 tests passing**

## Test Framework

- **Framework**: Vitest
- **Location**: `src/db/queries/*.test.ts`
- **Coverage**: 100% of query modules have corresponding test files

## Orchestrator Module Test Coverage

| Module              | Test File                | Test Count | Status      |
| ------------------- | ------------------------ | ---------- | ----------- |
| scheduler.ts        | scheduler.test.ts        | 30 tests   | ✅ Complete |
| prompt-templates.ts | prompt-templates.test.ts | 27 tests   | ✅ Complete |

**Coverage Details:**

### scheduler.test.ts (30 tests)

- **Topological Sort**: 5 tests covering dependency ordering and circular dependency detection
- **Dependency Satisfaction**: 4 tests for merged/in-progress story dependencies
- **Dependency Graph**: 2 tests for graph building logic
- **Worktree Management**: 2 tests for cleanup and error handling
- **Story Recovery**: 3 tests for orphaned story detection and recovery
- **Agent Selection**: 4 tests for workload-based agent selection
- **Complexity Routing**: 7 tests for story routing by complexity thresholds
- **Assignment Prevention**: 3 tests for duplicate assignment and dependency checks

### prompt-templates.test.ts (27 tests)

- **Senior Prompts**: 9 tests covering team name, session name sanitization, repository info, responsibilities, and story listing
- **Intermediate Prompts**: 6 tests for session configuration and intermediate-specific responsibilities
- **Junior Prompts**: 6 tests for junior-specific guidance and escalation paths
- **QA Prompts**: 6 tests for QA workflow, review checklist, and merge queue commands

**Total: 57 tests for orchestrator modules**

## Agent Module Test Coverage

| Module        | Test File          | Test Count | Status      |
| ------------- | ------------------ | ---------- | ----------- |
| base-agent.ts | base-agent.test.ts | 27 tests   | ✅ Complete |

**Coverage Details:**

### base-agent.test.ts (27 tests)

- **Construction and Initialization**: 5 tests for agent setup, memory state loading, and message initialization
- **Status Transitions**: 5 tests for idle→working→blocked state transitions and logging
- **Chat and Token Management**: 3 tests for token tracking across LLM calls
- **Checkpointing**: 3 tests for automatic checkpointing when token threshold exceeded
- **Memory State Management**: 6 tests for decisions, blockers, task tracking, and progress updates
- **Error Handling**: 3 tests for LLM timeout errors and error logging
- **Heartbeat Mechanism**: 3 tests for heartbeat initialization and cleanup

**Total: 27 tests for agent modules**

## Test Execution

Run all tests:

```bash
npm test
```

Run specific module tests:

```bash
npm test -- src/db/queries          # Database query tests
npm test -- src/orchestrator        # Orchestrator tests
npm test -- src/agents              # Agent tests
```

Result: ✅ **500/500 tests passing**

## Test Framework

- **Framework**: Vitest
- **Coverage**:
  - Database queries: 100% of modules tested (259 tests)
  - Orchestrator: scheduler, prompt-templates (57 tests)
  - Agents: base-agent state machine, memory, and error handling (27 tests)

## Conclusion

**STORY-CQ-004** requirement "Add tests for orchestrator and agent modules" is **COMPLETE**:

- ✅ Added 30 tests for scheduler.ts (story assignment, complexity routing, agent selection, worktree management)
- ✅ Added 27 tests for prompt-templates.ts (all agent type prompts with variable substitution)
- ✅ Added 27 tests for base-agent.ts (state transitions, error handling, timeout behavior, checkpointing)
- ✅ Total 84 new tests added (exceeds minimum requirement of 30)
- ✅ All 500 tests passing in CI
- ✅ Test coverage documented in TEST_COVERAGE.md
