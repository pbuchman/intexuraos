import { describe, it, expect } from 'vitest';
import {
  type ServiceFeedback,
  isSuccessFeedback,
  isFailureFeedback,
  successFeedback,
  failureFeedback,
} from '../serviceFeedback.js';
import { ServiceErrorCodes } from '../serviceErrorCodes.js';

describe('ServiceFeedback', () => {
  describe('successFeedback', () => {
    it('creates success feedback with message only', () => {
      const feedback = successFeedback('Issue created successfully');

      expect(feedback).toEqual({
        status: 'completed',
        message: 'Issue created successfully',
        resourceUrl: undefined,
      });
    });

    it('creates success feedback with resourceUrl', () => {
      const feedback = successFeedback(
        'Issue created successfully',
        'https://linear.app/team/issue/INT-123'
      );

      expect(feedback).toEqual({
        status: 'completed',
        message: 'Issue created successfully',
        resourceUrl: 'https://linear.app/team/issue/INT-123',
      });
    });
  });

  describe('failureFeedback', () => {
    it('creates failure feedback with message and error code', () => {
      const feedback = failureFeedback(
        'Failed to extract issue details from prompt',
        ServiceErrorCodes.EXTRACTION_FAILED
      );

      expect(feedback).toEqual({
        status: 'failed',
        message: 'Failed to extract issue details from prompt',
        errorCode: 'EXTRACTION_FAILED',
      });
    });
  });

  describe('isSuccessFeedback', () => {
    it('returns true for completed status', () => {
      const feedback: ServiceFeedback = {
        status: 'completed',
        message: 'Done',
      };

      expect(isSuccessFeedback(feedback)).toBe(true);
    });

    it('returns false for failed status', () => {
      const feedback: ServiceFeedback = {
        status: 'failed',
        message: 'Error',
        errorCode: 'TIMEOUT',
      };

      expect(isSuccessFeedback(feedback)).toBe(false);
    });
  });

  describe('isFailureFeedback', () => {
    it('returns true for failed status', () => {
      const feedback: ServiceFeedback = {
        status: 'failed',
        message: 'Error',
        errorCode: 'TIMEOUT',
      };

      expect(isFailureFeedback(feedback)).toBe(true);
    });

    it('returns false for completed status', () => {
      const feedback: ServiceFeedback = {
        status: 'completed',
        message: 'Done',
      };

      expect(isFailureFeedback(feedback)).toBe(false);
    });
  });
});

describe('ServiceErrorCodes', () => {
  it('exports all expected error codes', () => {
    expect(ServiceErrorCodes.TIMEOUT).toBe('TIMEOUT');
    expect(ServiceErrorCodes.SERVICE_UNAVAILABLE).toBe('SERVICE_UNAVAILABLE');
    expect(ServiceErrorCodes.AUTH_FAILED).toBe('AUTH_FAILED');
    expect(ServiceErrorCodes.UNAUTHORIZED).toBe('UNAUTHORIZED');
    expect(ServiceErrorCodes.VALIDATION_ERROR).toBe('VALIDATION_ERROR');
    expect(ServiceErrorCodes.INVALID_INPUT).toBe('INVALID_INPUT');
    expect(ServiceErrorCodes.DUPLICATE).toBe('DUPLICATE');
    expect(ServiceErrorCodes.NOT_FOUND).toBe('NOT_FOUND');
    expect(ServiceErrorCodes.EXTRACTION_FAILED).toBe('EXTRACTION_FAILED');
    expect(ServiceErrorCodes.EXTERNAL_API_ERROR).toBe('EXTERNAL_API_ERROR');
  });
});
