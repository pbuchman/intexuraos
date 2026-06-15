/**
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { LinearIssue } from '@/types';
import { IssueColumn } from '../IssueColumn.js';

afterEach(() => {
  cleanup();
});

const issue: LinearIssue = {
  id: 'i1',
  identifier: 'INT-1',
  title: 'First issue',
  description: null,
  url: 'https://linear.app/x/issue/INT-1',
  priority: 3,
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

describe('IssueColumn', () => {
  it('shows empty state when no issues', () => {
    render(<IssueColumn title="Todo" icon={<span>icon</span>} issues={[]} />);
    expect(screen.getByText('No issues')).toBeTruthy();
  });

  it('renders issues with count badge', () => {
    render(<IssueColumn title="Planning" icon={<span>icon</span>} issues={[issue]} />);
    expect(screen.getByText('Planning')).toBeTruthy();
    expect(screen.getByText('1')).toBeTruthy();
    expect(screen.getByText('First issue')).toBeTruthy();
  });
});
