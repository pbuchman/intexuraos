import { useCallback, useEffect, useState } from 'react';
import { getErrorMessage } from '@intexuraos/common-core/errors';
import { useAuth } from '@/context';
import {
  getLinearConnection,
  listLinearIssues,
  validateLinearIssue,
  generateLinearIssueTitle,
} from '@/services/linearApi';
import type { LinearIssue } from '@/types';

export interface LinearIssueOption {
  identifier: string;
  title: string;
  url: string;
  state?: LinearIssue['state'];
  priority: LinearIssue['priority'];
  /** ID of parent issue (null if top-level, set if subtask) */
  parentId: string | null;
}

export type GroupedLinearIssueOptions = Record<string, LinearIssueOption[]>;

interface UseLinearIssueOptionsResult {
  options: LinearIssueOption[];
  groupedOptions: GroupedLinearIssueOptions;
  loading: boolean;
  error: string | null;
  validateIssue: (identifier: string) => Promise<LinearIssueOption | null>;
  generateTitle: (description: string) => Promise<string>;
  refresh: () => Promise<void>;
}

export function useLinearIssueOptions(): UseLinearIssueOptionsResult {
  const { getAccessToken, user } = useAuth();
  const [options, setOptions] = useState<LinearIssueOption[]>([]);
  const [groupedOptions, setGroupedOptions] = useState<GroupedLinearIssueOptions>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadIssues = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);

    try {
      const token = await getAccessToken();
      const connection = await getLinearConnection(token);

      if (connection === null) {
        setOptions([]);
        setGroupedOptions({});
        setLoading(false);
        return;
      }

      const data = await listLinearIssues(token);

      const toOption = (issue: LinearIssue): LinearIssueOption => ({
        identifier: issue.identifier,
        title: issue.title,
        url: issue.url,
        state: issue.state,
        priority: issue.priority,
        parentId: issue.parentId,
      });

      const grouped: GroupedLinearIssueOptions = {};
      for (const [key, issues] of Object.entries(data.issues)) {
        const mapped = issues.map(toOption);
        if (mapped.length > 0) {
          grouped[key] = mapped;
        }
      }

      setGroupedOptions(grouped);
      setOptions(Object.values(data.issues).flat().map(toOption));
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load Linear issues'));
    } finally {
      setLoading(false);
    }
  }, [getAccessToken]);

  const refresh = useCallback(async (): Promise<void> => {
    await loadIssues();
  }, [loadIssues]);

  const validateIssue = useCallback(
    async (identifier: string): Promise<LinearIssueOption | null> => {
      try {
        const token = await getAccessToken();
        const validated = await validateLinearIssue(token, identifier, user?.sub ?? '');
        return {
          identifier: validated.identifier,
          title: validated.title,
          url: validated.url,
          priority: 0,
          parentId: null,
        };
      } catch {
        return null;
      }
    },
    [getAccessToken, user?.sub]
  );

  const generateTitle = useCallback(
    async (description: string): Promise<string> => {
      const token = await getAccessToken();
      const result = await generateLinearIssueTitle(token, description, user?.sub ?? '');
      return result.title;
    },
    [getAccessToken, user?.sub]
  );

  useEffect(() => {
    void loadIssues();
  }, [loadIssues]);

  return {
    options,
    groupedOptions,
    loading,
    error,
    validateIssue,
    generateTitle,
    refresh,
  };
}
