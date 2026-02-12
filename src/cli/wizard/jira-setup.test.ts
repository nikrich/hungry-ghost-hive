// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { describe, expect, it } from 'vitest';
import { autoDetectStatusMapping, type JiraStatus } from './jira-setup.js';

describe('autoDetectStatusMapping', () => {
  it('should map statuses based on category key', () => {
    const statuses: JiraStatus[] = [
      {
        id: '1',
        name: 'To Do',
        statusCategory: { id: 1, key: 'new', name: 'To Do' },
      },
      {
        id: '2',
        name: 'In Progress',
        statusCategory: { id: 2, key: 'indeterminate', name: 'In Progress' },
      },
      {
        id: '3',
        name: 'Done',
        statusCategory: { id: 3, key: 'done', name: 'Done' },
      },
    ];

    const mapping = autoDetectStatusMapping(statuses);

    expect(mapping['To Do']).toBe('draft');
    expect(mapping['In Progress']).toBe('in_progress');
    expect(mapping['Done']).toBe('merged');
  });

  it('should use naming patterns as fallback', () => {
    const statuses: JiraStatus[] = [
      {
        id: '1',
        name: 'Backlog',
        statusCategory: { id: 1, key: 'other', name: 'Other' },
      },
      {
        id: '2',
        name: 'In Development',
        statusCategory: { id: 2, key: 'other', name: 'Other' },
      },
      {
        id: '3',
        name: 'In Review',
        statusCategory: { id: 3, key: 'other', name: 'Other' },
      },
      {
        id: '4',
        name: 'Closed',
        statusCategory: { id: 4, key: 'other', name: 'Other' },
      },
    ];

    const mapping = autoDetectStatusMapping(statuses);

    expect(mapping['Backlog']).toBe('draft');
    expect(mapping['In Development']).toBe('in_progress');
    expect(mapping['In Review']).toBe('review');
    expect(mapping['Closed']).toBe('merged');
  });

  it('should default to in_progress for unknown statuses', () => {
    const statuses: JiraStatus[] = [
      {
        id: '1',
        name: 'Unknown Status',
        statusCategory: { id: 1, key: 'other', name: 'Other' },
      },
    ];

    const mapping = autoDetectStatusMapping(statuses);

    expect(mapping['Unknown Status']).toBe('in_progress');
  });

  it('should handle mixed case status names', () => {
    const statuses: JiraStatus[] = [
      {
        id: '1',
        name: 'TODO',
        statusCategory: { id: 1, key: 'other', name: 'Other' },
      },
      {
        id: '2',
        name: 'DOING',
        statusCategory: { id: 2, key: 'other', name: 'Other' },
      },
      {
        id: '3',
        name: 'TESTING',
        statusCategory: { id: 3, key: 'other', name: 'Other' },
      },
      {
        id: '4',
        name: 'COMPLETE',
        statusCategory: { id: 4, key: 'other', name: 'Other' },
      },
    ];

    const mapping = autoDetectStatusMapping(statuses);

    expect(mapping['TODO']).toBe('draft');
    expect(mapping['DOING']).toBe('in_progress');
    expect(mapping['TESTING']).toBe('review');
    expect(mapping['COMPLETE']).toBe('merged');
  });
});
