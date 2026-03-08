// Licensed under the Hungry Ghost Hive License. See LICENSE.

/**
 * ChromeTabManager — in-memory registry that maps agent IDs to their
 * dedicated Chrome tab IDs, enforcing tab isolation between concurrent agents.
 *
 * Each Chrome-enabled agent creates its own browser tab at session start
 * (via tabs_create_mcp) and registers it here. All subsequent browser
 * operations for that agent must target only its registered tab. When the
 * agent session ends, its tab entry is released.
 */
export class ChromeTabManager {
  private readonly agentToTab = new Map<string, number>();
  private readonly tabToAgent = new Map<number, string>();

  /**
   * Register a browser tab for an agent. Replaces any existing tab
   * registration for the same agent (handles tab recreation after external
   * close).
   *
   * @throws {Error} if the tab is already owned by a different agent
   */
  registerTab(agentId: string, tabId: number): void {
    const existingOwner = this.tabToAgent.get(tabId);
    if (existingOwner !== undefined && existingOwner !== agentId) {
      throw new Error(
        `Tab ${tabId} is already registered to agent ${existingOwner}. ` +
          `Agents must not share browser tabs.`
      );
    }

    // Clean up the agent's previous tab if any
    const previousTabId = this.agentToTab.get(agentId);
    if (previousTabId !== undefined && previousTabId !== tabId) {
      this.tabToAgent.delete(previousTabId);
    }

    this.agentToTab.set(agentId, tabId);
    this.tabToAgent.set(tabId, agentId);
  }

  /**
   * Get the tab ID registered for an agent, or null if none.
   */
  getTab(agentId: string): number | null {
    return this.agentToTab.get(agentId) ?? null;
  }

  /**
   * Release the tab registration for an agent (called on session end).
   * Returns the released tab ID, or null if the agent had no registered tab.
   */
  releaseTab(agentId: string): number | null {
    const tabId = this.agentToTab.get(agentId);
    if (tabId === undefined) {
      return null;
    }
    this.agentToTab.delete(agentId);
    this.tabToAgent.delete(tabId);
    return tabId;
  }

  /**
   * Check whether a tab ID is currently registered to any agent.
   */
  isTabRegistered(tabId: number): boolean {
    return this.tabToAgent.has(tabId);
  }

  /**
   * Return the agent ID that owns a given tab, or null.
   */
  getOwner(tabId: number): string | null {
    return this.tabToAgent.get(tabId) ?? null;
  }

  /**
   * Return all current agent→tab mappings.
   */
  getAllTabs(): ReadonlyMap<string, number> {
    return this.agentToTab;
  }

  /**
   * Release all registrations (used for cleanup in tests or shutdown).
   */
  clear(): void {
    this.agentToTab.clear();
    this.tabToAgent.clear();
  }
}

/** Singleton used by the scheduler to track tab assignments at runtime. */
export const chromeTabManager = new ChromeTabManager();
