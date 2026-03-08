// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ChromeTabManager } from './chrome-tab-manager.js';

describe('ChromeTabManager', () => {
  let manager: ChromeTabManager;

  beforeEach(() => {
    manager = new ChromeTabManager();
  });

  afterEach(() => {
    manager.clear();
  });

  describe('registerTab', () => {
    it('registers a tab for an agent', () => {
      manager.registerTab('agent-1', 101);
      expect(manager.getTab('agent-1')).toBe(101);
    });

    it('allows the same agent to re-register a new tab (handles external close)', () => {
      manager.registerTab('agent-1', 101);
      manager.registerTab('agent-1', 202);
      expect(manager.getTab('agent-1')).toBe(202);
      expect(manager.isTabRegistered(101)).toBe(false);
      expect(manager.isTabRegistered(202)).toBe(true);
    });

    it('allows re-registering the same tab for the same agent', () => {
      manager.registerTab('agent-1', 101);
      expect(() => manager.registerTab('agent-1', 101)).not.toThrow();
      expect(manager.getTab('agent-1')).toBe(101);
    });

    it('throws when another agent tries to claim an already-owned tab', () => {
      manager.registerTab('agent-1', 101);
      expect(() => manager.registerTab('agent-2', 101)).toThrow(
        'Tab 101 is already registered to agent agent-1'
      );
    });
  });

  describe('tab isolation between concurrent agents', () => {
    it('each agent gets its own dedicated tab', () => {
      manager.registerTab('agent-alpha', 10);
      manager.registerTab('agent-beta', 20);
      manager.registerTab('agent-gamma', 30);

      expect(manager.getTab('agent-alpha')).toBe(10);
      expect(manager.getTab('agent-beta')).toBe(20);
      expect(manager.getTab('agent-gamma')).toBe(30);
    });

    it("agents cannot access each other's tabs", () => {
      manager.registerTab('agent-alpha', 10);
      manager.registerTab('agent-beta', 20);

      // agent-beta cannot claim agent-alpha's tab
      expect(() => manager.registerTab('agent-beta', 10)).toThrow();
      // agent-alpha cannot claim agent-beta's tab
      expect(() => manager.registerTab('agent-alpha', 20)).toThrow();
    });

    it('getOwner returns correct agent for each tab', () => {
      manager.registerTab('agent-1', 100);
      manager.registerTab('agent-2', 200);

      expect(manager.getOwner(100)).toBe('agent-1');
      expect(manager.getOwner(200)).toBe('agent-2');
      expect(manager.getOwner(999)).toBeNull();
    });
  });

  describe('releaseTab', () => {
    it('releases the tab and returns its ID', () => {
      manager.registerTab('agent-1', 101);
      const released = manager.releaseTab('agent-1');
      expect(released).toBe(101);
      expect(manager.getTab('agent-1')).toBeNull();
      expect(manager.isTabRegistered(101)).toBe(false);
    });

    it('returns null when agent has no registered tab', () => {
      const released = manager.releaseTab('agent-unknown');
      expect(released).toBeNull();
    });

    it('allows another agent to claim a tab after its owner releases it', () => {
      manager.registerTab('agent-1', 101);
      manager.releaseTab('agent-1');
      expect(() => manager.registerTab('agent-2', 101)).not.toThrow();
      expect(manager.getTab('agent-2')).toBe(101);
    });
  });

  describe('getTab', () => {
    it('returns null for an agent with no registered tab', () => {
      expect(manager.getTab('agent-nobody')).toBeNull();
    });
  });

  describe('isTabRegistered', () => {
    it('returns true for a registered tab', () => {
      manager.registerTab('agent-1', 42);
      expect(manager.isTabRegistered(42)).toBe(true);
    });

    it('returns false for an unregistered tab', () => {
      expect(manager.isTabRegistered(999)).toBe(false);
    });
  });

  describe('getAllTabs', () => {
    it('returns all current agent-to-tab mappings', () => {
      manager.registerTab('agent-1', 10);
      manager.registerTab('agent-2', 20);

      const all = manager.getAllTabs();
      expect(all.get('agent-1')).toBe(10);
      expect(all.get('agent-2')).toBe(20);
      expect(all.size).toBe(2);
    });

    it('does not include released agents', () => {
      manager.registerTab('agent-1', 10);
      manager.registerTab('agent-2', 20);
      manager.releaseTab('agent-1');

      const all = manager.getAllTabs();
      expect(all.has('agent-1')).toBe(false);
      expect(all.get('agent-2')).toBe(20);
    });
  });

  describe('clear', () => {
    it('removes all registrations', () => {
      manager.registerTab('agent-1', 10);
      manager.registerTab('agent-2', 20);
      manager.clear();

      expect(manager.getAllTabs().size).toBe(0);
      expect(manager.getTab('agent-1')).toBeNull();
      expect(manager.isTabRegistered(10)).toBe(false);
    });
  });
});
