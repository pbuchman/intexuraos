/**
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { LinearIssue } from '@/types';
import { IssueCard } from '../IssueCard.js';

afterEach(() => {
  cleanup();
});

const baseIssue: LinearIssue = {
  id: 'issue-1',
  identifier: 'INT-1',
  title: 'Test issue',
  description: null,
  url: 'https://linear.app/x/issue/INT-1',
  priority: 1,
  labels: [],
  assignee: null,
  state: { id: 's1', name: 'Todo', type: 'unstarted' },
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
  dueDate: null,
  parentId: null,
  childCount: 0,
  children: [],
};

describe('IssueCard', () => {
  it('renders identifier, title, and priority label', () => {
    render(<IssueCard issue={baseIssue} />);
    expect(screen.getByText('INT-1')).toBeTruthy();
    expect(screen.getByText('Test issue')).toBeTruthy();
    expect(screen.getByText('Urgent')).toBeTruthy();
  });

  it('renders sub-issues when children are present', () => {
    const child: LinearIssue = { ...baseIssue, id: 'c1', identifier: 'INT-2', title: 'Child' };
    render(<IssueCard issue={{ ...baseIssue, children: [child] }} />);
    expect(screen.getByText('Sub-issues (1)')).toBeTruthy();
    expect(screen.getByText('INT-2')).toBeTruthy();
  });

  it('renders "No priority" label for priority 0', () => {
    render(<IssueCard issue={{ ...baseIssue, priority: 0 }} />);
    expect(screen.getByText('No priority')).toBeTruthy();
  });
});
