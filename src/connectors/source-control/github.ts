// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type {
  ConnectorPRInfo,
  ConnectorPRResult,
  ConnectorPRReview,
  CreatePROptions,
  MergePROptions,
} from '../common-types.js';
import { registry } from '../registry.js';
import type { ISourceControlConnector } from './types.js';

/**
 * GitHub implementation of ISourceControlConnector.
 *
 * Thin adapter that delegates to the existing `src/git/github.ts` utilities.
 * All PR operations go through the `gh` CLI under the hood.
 */
export class GitHubSourceControlConnector implements ISourceControlConnector {
  readonly provider = 'github';

  async createPullRequest(workDir: string, options: CreatePROptions): Promise<ConnectorPRResult> {
    const { createPullRequest } = await import('../../git/github.js');
    return createPullRequest(workDir, options);
  }

  async mergePullRequest(workDir: string, prNumber: number, options?: MergePROptions): Promise<void> {
    const { mergePullRequest } = await import('../../git/github.js');
    await mergePullRequest(workDir, prNumber, {
      method: options?.method,
      deleteAfterMerge: options?.deleteAfterMerge,
    });
  }

  async listPullRequests(
    workDir: string,
    state?: 'open' | 'closed' | 'all'
  ): Promise<ConnectorPRInfo[]> {
    const { listPullRequests } = await import('../../git/github.js');
    return listPullRequests(workDir, state);
  }

  async getPullRequestDiff(workDir: string, prNumber: number): Promise<string> {
    const { getPullRequestDiff } = await import('../../git/github.js');
    return getPullRequestDiff(workDir, prNumber);
  }

  async addPRComment(workDir: string, prNumber: number, body: string): Promise<void> {
    const { commentOnPullRequest } = await import('../../git/github.js');
    await commentOnPullRequest(workDir, prNumber, body);
  }

  async getPRReviews(workDir: string, prNumber: number): Promise<ConnectorPRReview[]> {
    const { getPullRequestReviews } = await import('../../git/github.js');
    const reviews = await getPullRequestReviews(workDir, prNumber);
    return reviews.map(r => ({
      author: r.author,
      state: r.state.toLowerCase() as ConnectorPRReview['state'],
      body: r.body,
    }));
  }

  async approvePullRequest(workDir: string, prNumber: number, body?: string): Promise<void> {
    const { reviewPullRequest } = await import('../../git/github.js');
    await reviewPullRequest(workDir, prNumber, {
      state: 'APPROVED',
      body: body ?? '',
    });
  }
}

/**
 * Register the GitHub source control connector with the global registry.
 * Call this once at startup to make the connector available via
 * `registry.getSourceControl('github')`.
 */
export function register(): void {
  registry.registerSourceControl('github', () => new GitHubSourceControlConnector());
}
