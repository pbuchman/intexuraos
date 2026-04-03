import { z } from 'zod';

const SeveritySchema = z.enum(['critical', 'warning', 'minor', 'pass']);

const AnomalyTypeSchema = z.enum([
  'fabrication',
  'ignored_error',
  'laziness',
  'wrong_conclusion',
  'permission_bypass',
  'hook_violation_storm',
  'degenerate_loop',
  'skill_substitution',
]);

const NullableMsgRef = z.string().nullable();

const ClaimVerificationSchema = z.object({
  ciTrackedCalled: z.object({
    called: z.boolean(),
    exitCode: z.number().nullable(),
    msgRef: NullableMsgRef,
  }),
  prCreated: z.object({
    created: z.boolean(),
    url: z.string().nullable(),
    msgRef: NullableMsgRef,
  }),
  commitCount: z.number().int().min(0),
  summaryAccurate: z.boolean(),
  summaryContradictions: z.array(z.string()),
});

const ContractComplianceSchema = z.object({
  subagentDrivenDevInvoked: z.object({
    invoked: z.boolean(),
    msgRef: NullableMsgRef,
  }),
  requestingCodeReviewInvoked: z.object({
    invoked: z.boolean(),
    msgRef: NullableMsgRef,
  }),
  codeReviewerDispatched: z.object({
    dispatched: z.boolean(),
    msgRef: NullableMsgRef,
  }),
  correctOrder: z.boolean(),
  skillViolations: z.array(z.string()),
});

const AnomalySchema = z.object({
  type: AnomalyTypeSchema,
  severity: SeveritySchema,
  msgRef: z.string(),
  description: z.string(),
});

const ExecutionMetricsSchema = z.object({
  totalMessages: z.number().int().min(0),
  hookViolationCount: z.number().int().min(0),
  toolErrorCount: z.number().int().min(0),
  subagentDispatchCount: z.number().int().min(0),
});

export const AgentComplianceReportSchema = z.object({
  claimVerification: ClaimVerificationSchema,
  contractCompliance: ContractComplianceSchema,
  anomalies: z.array(AnomalySchema),
  executionMetrics: ExecutionMetricsSchema,
});

export type AgentComplianceReport = z.infer<typeof AgentComplianceReportSchema>;
export type ComplianceAnomaly = z.infer<typeof AnomalySchema>;
export type ComplianceSeverity = z.infer<typeof SeveritySchema>;
