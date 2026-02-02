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
  state?: LinearIssue['status'];
  priority: LinearIssue['priority'];
}

interface UseLinearIssueOptionsResult {
  options: LinearIssueOption[];
  loading: boolean;
  error: string | null;
  validateIssue: (identifier: string) => Promise<LinearIssueOption | null>;
  generateTitle: (description: string) => Promise<string>;
  refresh: () => Promise<void>;
}

export function useLinearIssueOptions(): UseLinearIssueOptionsResult {
  const { getAccessToken, user } = useAuth();
  const [options, setOptions] = useState<LinearIssueOption[]>([]);
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
        setLoading(false);
        return;
      }

      const data = await listLinearIssues(token);

      const allOptions = Object.values(data.issues).flat();

      setOptions(
        allOptions.map((issue) => ({
          identifier: issue.identifier,
          title: issue.title,
          url: issue.url,
          state: issue.status,
          priority: issue.priority,
        }))
      );
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
    loading,
    error,
    validateIssue,
    generateTitle,
    refresh,
  };
}
