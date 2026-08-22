import { z } from 'zod';

const nonBlankStringSchema = z.string().trim().min(1);
const calendarDateSchema = z.string().date();
const offsetIsoDateTimeSchema = z.string().datetime({ offset: true });
const ianaTimeZoneSchema = nonBlankStringSchema.refine(isIanaTimeZone, {
  message: 'Expected a valid IANA time zone',
});

const calendarEventDateTimeSchema = z
  .object({
    dateTime: offsetIsoDateTimeSchema.optional(),
    date: calendarDateSchema.optional(),
    timeZone: ianaTimeZoneSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const hasDate = value.date !== undefined;
    const hasDateTime = value.dateTime !== undefined;
    if (hasDate === hasDateTime) {
      context.addIssue({
        code: 'custom',
        message: 'Calendar date-time requires exactly one of date or dateTime',
      });
    }
  });

const attendeeEmailsSchema = z.array(z.string().email()).min(1);

export const IntexAgentCalendarUpdatePlanningChangesSchema = z
  .object({
    summary: nonBlankStringSchema.optional(),
    description: z.string().nullable().optional(),
    location: z.string().nullable().optional(),
    start: calendarEventDateTimeSchema.optional(),
    end: calendarEventDateTimeSchema.optional(),
    attendeesToAdd: attendeeEmailsSchema.optional(),
    attendeesToRemove: attendeeEmailsSchema.optional(),
  })
  .strict()
  .superRefine((changes, context) => {
    if (Object.values(changes).every((value) => value === undefined)) {
      context.addIssue({
        code: 'custom',
        message: 'At least one calendar event change is required',
      });
    }

    if ((changes.start === undefined) !== (changes.end === undefined)) {
      context.addIssue({
        code: 'custom',
        message: 'Calendar event start and end must be updated together',
      });
      return;
    }
    if (changes.start === undefined || changes.end === undefined) return;

    const startKind = changes.start.date === undefined ? 'dateTime' : 'date';
    const endKind = changes.end.date === undefined ? 'dateTime' : 'date';
    if (startKind !== endKind) {
      context.addIssue({
        code: 'custom',
        message: 'Calendar event start and end must use the same date type',
      });
    }
  });

export const IntexAgentCalendarUpdatePlanningOperationSchema = z
  .object({
    eventId: nonBlankStringSchema,
    eventSummary: nonBlankStringSchema,
    changes: IntexAgentCalendarUpdatePlanningChangesSchema,
  })
  .strict();

const updateOperationsSchema = z
  .array(IntexAgentCalendarUpdatePlanningOperationSchema)
  .min(1)
  .max(20)
  .superRefine((operations, context) => {
    const seenEventIds = new Set<string>();
    operations.forEach((operation, index) => {
      if (seenEventIds.has(operation.eventId)) {
        context.addIssue({
          code: 'custom',
          message: 'Each calendar event may appear only once in an update plan',
          path: [index, 'eventId'],
        });
      }
      seenEventIds.add(operation.eventId);
    });
  });

export const IntexAgentCalendarUpdatePlanningOutputSchema = z.union([
  z
    .object({
      outcome: z.literal('proposal_only'),
      reply: nonBlankStringSchema,
    })
    .strict(),
  z
    .object({
      outcome: z.literal('needs_clarification'),
      question: nonBlankStringSchema,
    })
    .strict(),
  z
    .object({
      outcome: z.literal('updates'),
      operations: updateOperationsSchema,
    })
    .strict(),
]);

export type IntexAgentCalendarUpdatePlanningChanges = z.infer<
  typeof IntexAgentCalendarUpdatePlanningChangesSchema
>;
export type IntexAgentCalendarUpdatePlanningOperation = z.infer<
  typeof IntexAgentCalendarUpdatePlanningOperationSchema
>;
export type IntexAgentCalendarUpdatePlanningOutput = z.infer<
  typeof IntexAgentCalendarUpdatePlanningOutputSchema
>;

function isIanaTimeZone(value: string): boolean {
  if (/^[+-]/u.test(value)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}
