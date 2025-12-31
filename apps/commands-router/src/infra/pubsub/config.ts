import type { ActionType } from '../../domain/models/action.js';

export const ACTION_TOPICS: Record<ActionType, string | null> = {
  research: 'intexuraos-actions-research',
  todo: null,
  note: null,
  link: null,
  calendar: null,
  reminder: null,
};
