// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { describe, expect, it } from 'vitest';
import type { ProjectManagementConnector, SCMConnector } from './interfaces.js';
import type {
  CreateEpicInput,
  CreateIssueResult,
  CreatePRInput,
  CreatePRResult,
  CreateStoryInput,
  CreateSubtaskInput,
  ExternalEpic,
  ExternalIssue,
  ExternalPRReview,
  ExternalPullRequest,
  ExternalSprint,
  ExternalTransition,
  LifecycleCommentContext,
  LifecycleEvent,
  MergePROptions,
} from './types.js';

// ── Mock PM Connector ───────────────────────────────────────────────────────

class MockPMConnector implements ProjectManagementConnector {
  readonly type = 'mock-pm';
  readonly displayName = 'Mock PM';

  async authenticate(): Promise<boolean> {
    return true;
  }

  recognizesUrl(url: string): boolean {
    return url.includes('mock-pm.example.com');
  }

  async fetchEpic(urlOrKey: string): Promise<ExternalEpic> {
    return {
      id: '1',
      key: 'MOCK-1',
      title: `Epic for ${urlOrKey}`,
      description: 'Test epic',
      status: { id: '1', name: 'To Do', category: 'todo' },
      labels: ['test'],
      project: { id: '1', key: 'MOCK', name: 'Mock Project' },
    };
  }

  async createEpic(_input: CreateEpicInput): Promise<CreateIssueResult> {
    return { id: '1', key: 'MOCK-1', url: 'https://mock-pm.example.com/MOCK-1' };
  }

  async createStory(_input: CreateStoryInput): Promise<CreateIssueResult> {
    return { id: '2', key: 'MOCK-2' };
  }

  async createSubtask(_input: CreateSubtaskInput): Promise<CreateIssueResult | null> {
    return { id: '3', key: 'MOCK-3' };
  }

  async fetchIssue(issueKey: string): Promise<ExternalIssue> {
    return {
      id: '1',
      key: issueKey,
      summary: 'Test Issue',
      description: 'A test issue',
      status: { id: '1', name: 'To Do', category: 'todo' },
      issueType: { id: '1', name: 'Story', subtask: false },
      labels: [],
      project: { id: '1', key: 'MOCK', name: 'Mock Project' },
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };
  }

  async postComment(
    _issueKey: string,
    _event: LifecycleEvent,
    _context?: LifecycleCommentContext
  ): Promise<boolean> {
    return true;
  }

  async postProgress(_subtaskKey: string, _message: string, _agentName?: string): Promise<boolean> {
    return true;
  }

  async transitionStatus(_issueKey: string, _targetStatus: string): Promise<boolean> {
    return true;
  }

  async getTransitions(_issueKey: string): Promise<ExternalTransition[]> {
    return [
      {
        id: '1',
        name: 'Start Progress',
        to: { id: '2', name: 'In Progress', category: 'in_progress' },
      },
    ];
  }

  async linkDependency(_fromKey: string, _toKey: string): Promise<void> {}

  async moveToSprint(_issueKeys: string[], _sprintId: string): Promise<void> {}

  async getActiveSprint(): Promise<ExternalSprint | null> {
    return {
      id: '1',
      name: 'Sprint 1',
      state: 'active',
      startDate: '2026-01-01T00:00:00Z',
      endDate: '2026-01-14T00:00:00Z',
    };
  }
}

// ── Mock SCM Connector ──────────────────────────────────────────────────────

class MockSCMConnector implements SCMConnector {
  readonly type = 'mock-scm';
  readonly displayName = 'Mock SCM';

  async isAuthenticated(): Promise<boolean> {
    return true;
  }

  async createPR(_workDir: string, _input: CreatePRInput): Promise<CreatePRResult> {
    return { number: 1, url: 'https://mock-scm.example.com/pr/1' };
  }

  async fetchPR(_workDir: string, prNumber: number): Promise<ExternalPullRequest> {
    return {
      id: '1',
      number: prNumber,
      url: `https://mock-scm.example.com/pr/${prNumber}`,
      title: 'Test PR',
      state: 'open',
      headBranch: 'feature/test',
      baseBranch: 'main',
      additions: 10,
      deletions: 5,
      changedFiles: 2,
    };
  }

  async listPRs(
    _workDir: string,
    _state?: 'open' | 'closed' | 'all'
  ): Promise<ExternalPullRequest[]> {
    return [];
  }

  async mergePR(_workDir: string, _prNumber: number, _options?: MergePROptions): Promise<void> {}

  async closePR(_workDir: string, _prNumber: number): Promise<void> {}

  async addReviewer(_workDir: string, _prNumber: number, _reviewer: string): Promise<void> {}

  async getReviews(_workDir: string, _prNumber: number): Promise<ExternalPRReview[]> {
    return [{ author: 'reviewer', state: 'approved', body: 'LGTM' }];
  }

  async commentOnPR(_workDir: string, _prNumber: number, _body: string): Promise<void> {}

  async getPRDiff(_workDir: string, _prNumber: number): Promise<string> {
    return '+ added line\n- removed line';
  }
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('ProjectManagementConnector', () => {
  const connector: ProjectManagementConnector = new MockPMConnector();

  it('should expose type and displayName', () => {
    expect(connector.type).toBe('mock-pm');
    expect(connector.displayName).toBe('Mock PM');
  });

  it('should authenticate', async () => {
    expect(await connector.authenticate()).toBe(true);
  });

  it('should recognize matching URLs', () => {
    expect(connector.recognizesUrl('https://mock-pm.example.com/browse/MOCK-1')).toBe(true);
    expect(connector.recognizesUrl('https://other.example.com/issue/1')).toBe(false);
  });

  it('should fetch an epic', async () => {
    const epic = await connector.fetchEpic('MOCK-1');
    expect(epic.key).toBe('MOCK-1');
    expect(epic.title).toContain('Epic for');
    expect(epic.status.category).toBe('todo');
    expect(epic.project.key).toBe('MOCK');
  });

  it('should create an epic', async () => {
    const result = await connector.createEpic({ title: 'New Epic', description: 'Desc' });
    expect(result.id).toBe('1');
    expect(result.key).toBe('MOCK-1');
    expect(result.url).toBeDefined();
  });

  it('should create a story', async () => {
    const result = await connector.createStory({
      title: 'New Story',
      description: 'Story desc',
      epicKey: 'MOCK-1',
      storyPoints: 5,
      labels: ['feature'],
    });
    expect(result.id).toBe('2');
    expect(result.key).toBe('MOCK-2');
  });

  it('should create a subtask', async () => {
    const result = await connector.createSubtask({
      parentIssueKey: 'MOCK-2',
      agentName: 'hive-senior-1',
      storyTitle: 'Test Story',
      approachSteps: ['Step 1', 'Step 2'],
    });
    expect(result).not.toBeNull();
    expect(result!.key).toBe('MOCK-3');
  });

  it('should fetch an issue', async () => {
    const issue = await connector.fetchIssue('MOCK-2');
    expect(issue.key).toBe('MOCK-2');
    expect(issue.summary).toBe('Test Issue');
    expect(issue.issueType.subtask).toBe(false);
  });

  it('should post a lifecycle comment', async () => {
    const result = await connector.postComment('MOCK-2', 'work_started', {
      agentName: 'hive-senior-1',
      branchName: 'feature/test',
    });
    expect(result).toBe(true);
  });

  it('should post progress to subtask', async () => {
    const result = await connector.postProgress('MOCK-3', 'Making progress', 'hive-senior-1');
    expect(result).toBe(true);
  });

  it('should transition issue status', async () => {
    const result = await connector.transitionStatus('MOCK-2', 'In Progress');
    expect(result).toBe(true);
  });

  it('should get available transitions', async () => {
    const transitions = await connector.getTransitions('MOCK-2');
    expect(transitions).toHaveLength(1);
    expect(transitions[0].to.name).toBe('In Progress');
    expect(transitions[0].to.category).toBe('in_progress');
  });

  it('should link dependencies', async () => {
    await expect(connector.linkDependency('MOCK-1', 'MOCK-2', 'blocks')).resolves.toBeUndefined();
  });

  it('should move issues to sprint', async () => {
    await expect(connector.moveToSprint(['MOCK-2'], '1')).resolves.toBeUndefined();
  });

  it('should get active sprint', async () => {
    const sprint = await connector.getActiveSprint();
    expect(sprint).not.toBeNull();
    expect(sprint!.state).toBe('active');
    expect(sprint!.name).toBe('Sprint 1');
  });
});

describe('SCMConnector', () => {
  const connector: SCMConnector = new MockSCMConnector();

  it('should expose type and displayName', () => {
    expect(connector.type).toBe('mock-scm');
    expect(connector.displayName).toBe('Mock SCM');
  });

  it('should check authentication', async () => {
    expect(await connector.isAuthenticated()).toBe(true);
  });

  it('should create a PR', async () => {
    const result = await connector.createPR('/tmp/repo', {
      title: 'feat: new feature',
      body: 'Description',
      baseBranch: 'main',
      headBranch: 'feature/test',
    });
    expect(result.number).toBe(1);
    expect(result.url).toContain('pr/1');
  });

  it('should fetch a PR', async () => {
    const pr = await connector.fetchPR('/tmp/repo', 42);
    expect(pr.number).toBe(42);
    expect(pr.state).toBe('open');
    expect(pr.headBranch).toBe('feature/test');
    expect(pr.baseBranch).toBe('main');
  });

  it('should list PRs', async () => {
    const prs = await connector.listPRs('/tmp/repo', 'open');
    expect(Array.isArray(prs)).toBe(true);
  });

  it('should merge a PR', async () => {
    await expect(
      connector.mergePR('/tmp/repo', 1, { method: 'squash', deleteBranch: true })
    ).resolves.toBeUndefined();
  });

  it('should close a PR', async () => {
    await expect(connector.closePR('/tmp/repo', 1)).resolves.toBeUndefined();
  });

  it('should add a reviewer', async () => {
    await expect(connector.addReviewer('/tmp/repo', 1, 'reviewer')).resolves.toBeUndefined();
  });

  it('should get reviews', async () => {
    const reviews = await connector.getReviews('/tmp/repo', 1);
    expect(reviews).toHaveLength(1);
    expect(reviews[0].state).toBe('approved');
  });

  it('should comment on a PR', async () => {
    await expect(connector.commentOnPR('/tmp/repo', 1, 'Great work!')).resolves.toBeUndefined();
  });

  it('should get PR diff', async () => {
    const diff = await connector.getPRDiff('/tmp/repo', 1);
    expect(diff).toContain('added line');
  });
});

describe('ExternalIssue type compatibility', () => {
  it('should support optional fields', () => {
    const minimal: ExternalIssue = {
      id: '1',
      key: 'TEST-1',
      summary: 'Minimal issue',
      description: '',
      status: { id: '1', name: 'Open', category: 'todo' },
      issueType: { id: '1', name: 'Story', subtask: false },
      labels: [],
      project: { id: '1', key: 'TEST', name: 'Test' },
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };
    expect(minimal.priority).toBeUndefined();
    expect(minimal.assignee).toBeUndefined();
    expect(minimal.storyPoints).toBeUndefined();
    expect(minimal.parentKey).toBeUndefined();
    expect(minimal.url).toBeUndefined();
    expect(minimal.raw).toBeUndefined();
  });

  it('should support all optional fields populated', () => {
    const full: ExternalIssue = {
      id: '1',
      key: 'TEST-1',
      summary: 'Full issue',
      description: 'Detailed description',
      status: { id: '2', name: 'In Progress', category: 'in_progress' },
      issueType: { id: '2', name: 'Subtask', subtask: true },
      priority: { id: '1', name: 'High' },
      assignee: { id: 'u1', displayName: 'Dev', email: 'dev@test.com' },
      reporter: { id: 'u2', displayName: 'PM' },
      labels: ['hive-managed'],
      storyPoints: 8,
      parentKey: 'TEST-0',
      project: { id: '1', key: 'TEST', name: 'Test' },
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-02T00:00:00Z',
      url: 'https://pm.example.com/TEST-1',
      raw: { provider_specific: true },
    };
    expect(full.storyPoints).toBe(8);
    expect(full.assignee?.email).toBe('dev@test.com');
    expect(full.raw).toBeDefined();
  });
});

describe('ExternalPullRequest type compatibility', () => {
  it('should support minimal PR', () => {
    const pr: ExternalPullRequest = {
      id: '1',
      number: 42,
      url: 'https://scm.example.com/pr/42',
      title: 'feat: something',
      state: 'open',
      headBranch: 'feature/x',
      baseBranch: 'main',
      additions: 0,
      deletions: 0,
      changedFiles: 0,
    };
    expect(pr.draft).toBeUndefined();
    expect(pr.reviewers).toBeUndefined();
  });
});

describe('LifecycleEvent types', () => {
  it('should cover all expected events', () => {
    const events: LifecycleEvent[] = [
      'assigned',
      'work_started',
      'progress',
      'approach_posted',
      'pr_created',
      'qa_started',
      'qa_passed',
      'qa_failed',
      'merged',
      'blocked',
    ];
    expect(events).toHaveLength(10);
  });
});
