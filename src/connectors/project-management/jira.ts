// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type { TokenStore } from '../../auth/token-store.js';
import type { JiraConfig } from '../../config/schema.js';
import {
  isJiraUrl,
  parseEpicUrl as jiraParseEpicUrl,
} from '../../integrations/jira/epic-import.js';
import type {
  ConnectorEpic,
  ConnectorIssue,
  ConnectorParsedEpicUrl,
  CreateEpicOptions,
  CreateStoryOptions,
  SearchIssuesOptions,
} from '../common-types.js';
import { registry } from '../registry.js';
import type { IProjectManagementConnector } from './types.js';

/**
 * Options required to construct a JiraProjectManagementConnector.
 */
export interface JiraPMConnectorOptions {
  config: JiraConfig;
  tokenStore: TokenStore;
}

/**
 * Jira implementation of IProjectManagementConnector.
 *
 * Thin adapter that delegates to existing Jira integration modules
 * in `src/integrations/jira/`. The JiraClient is created lazily
 * on first API call, and config/tokenStore are loaded from the workspace.
 */
export class JiraProjectManagementConnector implements IProjectManagementConnector {
  readonly provider = 'jira';

  private config?: JiraConfig;
  private tokenStore?: TokenStore;

  constructor(options?: JiraPMConnectorOptions) {
    if (options) {
      this.config = options.config;
      this.tokenStore = options.tokenStore;
    }
  }

  private async loadConfigAndTokenStore(): Promise<{ config: JiraConfig; tokenStore: TokenStore }> {
    if (this.config && this.tokenStore) {
      return { config: this.config, tokenStore: this.tokenStore };
    }

    // Load config from workspace
    const { loadConfig } = await import('../../config/loader.js');
    const { getHivePaths } = await import('../../utils/paths.js');
    const { TokenStore } = await import('../../auth/token-store.js');
    const { join } = await import('path');

    const paths = getHivePaths(process.cwd());
    const config = loadConfig(paths.hiveDir);

    if (!config.integrations.project_management.jira) {
      throw new Error('Jira is not configured. Run "hive init" or configure Jira in config.yml');
    }

    const envPath = join(paths.hiveDir, '.env');
    const tokenStore = new TokenStore(envPath);
    await tokenStore.loadFromEnv(envPath);

    // Cache for future calls
    this.config = config.integrations.project_management.jira;
    this.tokenStore = tokenStore;

    return { config: this.config, tokenStore };
  }

  private async getClient() {
    const { loadEnvIntoProcess } = await import('../../auth/env-store.js');
    const { JiraClient } = await import('../../integrations/jira/client.js');
    const { tokenStore } = await this.loadConfigAndTokenStore();

    loadEnvIntoProcess();
    return new JiraClient({
      tokenStore,
      clientId: process.env.JIRA_CLIENT_ID || '',
      clientSecret: process.env.JIRA_CLIENT_SECRET || '',
    });
  }

  async fetchEpic(issueKeyOrUrl: string): Promise<ConnectorEpic> {
    const { fetchEpicFromJira } = await import('../../integrations/jira/epic-import.js');

    let issueKey = issueKeyOrUrl;
    if (isJiraUrl(issueKeyOrUrl)) {
      const parsed = jiraParseEpicUrl(issueKeyOrUrl);
      if (!parsed) {
        throw new Error(`Could not parse Jira epic URL: ${issueKeyOrUrl}`);
      }
      issueKey = parsed.issueKey;
    }

    const client = await this.getClient();
    const epic = await fetchEpicFromJira(client, issueKey);

    return {
      key: epic.key,
      id: epic.id,
      title: epic.title,
      description: epic.description,
      provider: this.provider,
      raw: epic.issue,
    };
  }

  async createEpic(options: CreateEpicOptions): Promise<{ key: string; id: string }> {
    const { createIssue } = await import('../../integrations/jira/issues.js');

    const client = await this.getClient();
    const result = await createIssue(client, {
      fields: {
        project: { key: options.projectKey },
        summary: options.title,
        issuetype: { name: 'Epic' },
        description: this.textToAdf(options.description),
        labels: options.labels,
      },
    });

    return { key: result.key, id: result.id };
  }

  async createStory(options: CreateStoryOptions): Promise<{ key: string; id: string }> {
    const { createIssue } = await import('../../integrations/jira/issues.js');
    const { config } = await this.loadConfigAndTokenStore();

    const client = await this.getClient();
    const fields: Record<string, unknown> = {
      project: { key: options.projectKey },
      summary: options.title,
      issuetype: { name: config.story_type || 'Story' },
      description: this.textToAdf(options.description),
      labels: options.labels,
    };

    if (options.epicKey) {
      fields.parent = { key: options.epicKey };
    }

    if (options.storyPoints !== undefined) {
      fields[config.story_points_field || 'story_points'] = options.storyPoints;
    }

    const result = await createIssue(client, { fields } as any);
    return { key: result.key, id: result.id };
  }

  async transitionStory(
    issueKeyOrId: string,
    targetStatus: string,
    statusMapping: Record<string, string>
  ): Promise<boolean> {
    const { transitionJiraIssue } = await import('../../integrations/jira/transitions.js');

    const client = await this.getClient();
    return transitionJiraIssue(client, issueKeyOrId, targetStatus, statusMapping);
  }

  async searchIssues(query: string, options?: SearchIssuesOptions): Promise<ConnectorIssue[]> {
    const { searchJql } = await import('../../integrations/jira/issues.js');
    const { adfToPlainText } = await import('../../integrations/jira/adf-utils.js');

    const client = await this.getClient();
    const result = await searchJql(client, query, {
      maxResults: options?.maxResults,
      fields: options?.fields,
    });

    return result.issues.map(issue => ({
      key: issue.key,
      id: issue.id,
      title: issue.fields.summary,
      description: adfToPlainText(issue.fields.description) || '',
      status: issue.fields.status.name,
      issueType: issue.fields.issuetype.name,
      labels: issue.fields.labels,
      assignee: issue.fields.assignee?.displayName,
      storyPoints: issue.fields.story_points ?? undefined,
      parentKey: issue.fields.parent?.key,
      provider: this.provider,
      raw: issue,
    }));
  }

  async getIssue(issueKeyOrId: string): Promise<ConnectorIssue> {
    const { getIssue } = await import('../../integrations/jira/issues.js');
    const { adfToPlainText } = await import('../../integrations/jira/adf-utils.js');

    const client = await this.getClient();
    const issue = await getIssue(client, issueKeyOrId);

    return {
      key: issue.key,
      id: issue.id,
      title: issue.fields.summary,
      description: adfToPlainText(issue.fields.description) || '',
      status: issue.fields.status.name,
      issueType: issue.fields.issuetype.name,
      labels: issue.fields.labels,
      assignee: issue.fields.assignee?.displayName,
      storyPoints: issue.fields.story_points ?? undefined,
      parentKey: issue.fields.parent?.key,
      provider: this.provider,
      raw: issue,
    };
  }

  async syncStatus(
    issueKeyOrId: string,
    hiveStatus: string,
    statusMapping: Record<string, string>
  ): Promise<boolean> {
    return this.transitionStory(issueKeyOrId, hiveStatus, statusMapping);
  }

  isEpicUrl(value: string): boolean {
    return isJiraUrl(value);
  }

  parseEpicUrl(url: string): ConnectorParsedEpicUrl | null {
    const parsed = jiraParseEpicUrl(url);
    if (!parsed) return null;
    return {
      issueKey: parsed.issueKey,
      siteUrl: parsed.siteUrl,
      provider: this.provider,
    };
  }

  /**
   * Convert plain text to a minimal ADF document.
   */
  private textToAdf(text: string) {
    if (!text) {
      return {
        version: 1 as const,
        type: 'doc' as const,
        content: [{ type: 'paragraph', content: [{ type: 'text', text: ' ' }] }],
      };
    }
    const paragraphs = text.split(/\n\n+/);
    return {
      version: 1 as const,
      type: 'doc' as const,
      content: paragraphs.map(para => ({
        type: 'paragraph',
        content: [{ type: 'text', text: para.trim() }],
      })),
    };
  }
}

/**
 * Register the Jira project management connector with the global registry.
 * The connector will load config and tokenStore lazily when first accessed.
 *
 * @param options - Optional config and tokenStore (primarily for testing)
 */
export function register(options?: JiraPMConnectorOptions): void {
  registry.registerProjectManagement('jira', () => new JiraProjectManagementConnector(options));
}
