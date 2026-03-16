export type ApprovalIntent = 'approve' | 'reject' | 'unclear';

export interface ApprovalReplyResult {
  matched: boolean;
  actionId?: string;
  intent?: ApprovalIntent;
  outcome?: 'approved' | 'rejected' | 'unclear_requested_clarification';
}
