import { describe, it, expect } from 'vitest';
import {
  AgentComplianceReportSchema,
  type AgentComplianceReport,
} from '../compliance-report-schema.js';

function buildPassingReport(): AgentComplianceReport {
  return {
    claimVerification: {
      ciTrackedCalled: { called: true, exitCode: 0, msgRef: 'MSG-042' },
      prCreated: {
        created: true,
        url: 'https://github.com/pbuchman/intexuraos/pull/999',
        msgRef: 'MSG-088',
      },
      commitCount: 3,
      summaryAccurate: true,
      summaryContradictions: [],
    },
    contractCompliance: {
      subagentDrivenDevInvoked: { invoked: true, msgRef: 'MSG-005' },
      requestingCodeReviewInvoked: { invoked: true, msgRef: 'MSG-070' },
      codeReviewerDispatched: { dispatched: true, msgRef: 'MSG-072' },
      correctOrder: true,
      skillViolations: [],
    },
    anomalies: [],
    executionMetrics: {
      totalMessages: 100,
      hookViolationCount: 0,
      toolErrorCount: 2,
      subagentDispatchCount: 1,
    },
  };
}

describe('AgentComplianceReportSchema', () => {
  it('accepts a complete passing report', () => {
    const result = AgentComplianceReportSchema.safeParse(buildPassingReport());
    expect(result.success).toBe(true);
  });

  it('accepts a report with null msgRef and url fields', () => {
    const report = buildPassingReport();
    report.claimVerification.ciTrackedCalled.msgRef = null;
    report.claimVerification.prCreated.url = null;
    report.claimVerification.prCreated.msgRef = null;
    report.contractCompliance.subagentDrivenDevInvoked.msgRef = null;
    report.contractCompliance.requestingCodeReviewInvoked.msgRef = null;
    report.contractCompliance.codeReviewerDispatched.msgRef = null;

    const result = AgentComplianceReportSchema.safeParse(report);
    expect(result.success).toBe(true);
  });

  it('accepts a report with anomalies of multiple types and severities', () => {
    const report = buildPassingReport();
    report.anomalies = [
      {
        type: 'fabrication',
        severity: 'critical',
        msgRef: 'MSG-015',
        description: 'Agent claimed tests passed but CI exit code was 1',
      },
      {
        type: 'laziness',
        severity: 'warning',
        msgRef: 'MSG-044',
        description: 'Agent skipped coverage check',
      },
      {
        type: 'hook_violation_storm',
        severity: 'minor',
        msgRef: 'MSG-060',
        description: 'Three consecutive hook violations detected',
      },
      {
        type: 'degenerate_loop',
        severity: 'pass',
        msgRef: 'MSG-080',
        description: 'Loop detected but resolved within threshold',
      },
    ];

    const result = AgentComplianceReportSchema.safeParse(report);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.anomalies).toHaveLength(4);
    }
  });

  it('accepts all valid anomaly types', () => {
    const validTypes = [
      'fabrication',
      'ignored_error',
      'laziness',
      'wrong_conclusion',
      'permission_bypass',
      'hook_violation_storm',
      'degenerate_loop',
      'skill_substitution',
    ] as const;

    for (const type of validTypes) {
      const report = buildPassingReport();
      report.anomalies = [
        { type, severity: 'warning', msgRef: 'MSG-001', description: `Test ${type}` },
      ];
      const result = AgentComplianceReportSchema.safeParse(report);
      expect(result.success, `expected type '${type}' to be valid`).toBe(true);
    }
  });

  it('rejects a report with an invalid anomaly type', () => {
    const report = buildPassingReport();
    // Force an invalid type via raw object
    const raw = JSON.parse(JSON.stringify(report)) as Record<string, unknown>;
    (
      raw as {
        anomalies: { type: string; severity: string; msgRef: string; description: string }[];
      }
    ).anomalies = [
      {
        type: 'unknown_type',
        severity: 'critical',
        msgRef: 'MSG-010',
        description: 'Invalid anomaly',
      },
    ];

    const result = AgentComplianceReportSchema.safeParse(raw);
    expect(result.success).toBe(false);
  });

  it('rejects a report with an invalid severity', () => {
    const raw = JSON.parse(JSON.stringify(buildPassingReport())) as Record<string, unknown>;
    (
      raw as {
        anomalies: { type: string; severity: string; msgRef: string; description: string }[];
      }
    ).anomalies = [
      {
        type: 'fabrication',
        severity: 'extreme',
        msgRef: 'MSG-010',
        description: 'Bad severity',
      },
    ];

    const result = AgentComplianceReportSchema.safeParse(raw);
    expect(result.success).toBe(false);
  });

  it('rejects a report with missing required fields', () => {
    const result = AgentComplianceReportSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects when claimVerification is missing fields', () => {
    const report = buildPassingReport();
    const raw = JSON.parse(JSON.stringify(report)) as Record<string, unknown>;
    (raw as { claimVerification: Record<string, unknown> }).claimVerification = {
      ciTrackedCalled: { called: true },
    };

    const result = AgentComplianceReportSchema.safeParse(raw);
    expect(result.success).toBe(false);
  });

  it('rejects when executionMetrics has negative values', () => {
    const report = buildPassingReport();
    const raw = JSON.parse(JSON.stringify(report)) as Record<string, unknown>;
    (raw as { executionMetrics: Record<string, unknown> }).executionMetrics = {
      totalMessages: -1,
      hookViolationCount: 0,
      toolErrorCount: 0,
      subagentDispatchCount: 0,
    };

    const result = AgentComplianceReportSchema.safeParse(raw);
    expect(result.success).toBe(false);
  });

  it('rejects when commitCount is not an integer', () => {
    const report = buildPassingReport();
    const raw = JSON.parse(JSON.stringify(report)) as Record<string, unknown>;
    (raw as { claimVerification: { commitCount: number } }).claimVerification.commitCount = 2.5;

    const result = AgentComplianceReportSchema.safeParse(raw);
    expect(result.success).toBe(false);
  });
});
