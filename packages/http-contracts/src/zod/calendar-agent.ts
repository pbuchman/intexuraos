import { z } from 'zod';
import {
  apiErrorEnvelopeZodSchema,
  createApiSuccessEnvelopeSchema,
  serviceFeedbackZodSchema,
} from './common.js';

export const calendarProcessActionRequestSchema = z
  .object({
    action: z
      .object({
        id: z.string(),
        userId: z.string(),
        title: z.string(),
      })
      .strict(),
    text: z.string(),
  })
  .strict();

export const calendarProcessActionResponseSchema =
  createApiSuccessEnvelopeSchema(serviceFeedbackZodSchema);

type CalendarEventDateTimeSchema = z.ZodObject<
  {
    dateTime: z.ZodOptional<z.ZodString>;
    date: z.ZodOptional<z.ZodString>;
    timeZone: z.ZodOptional<z.ZodString>;
  },
  'strict'
>;

const createCalendarEventDateTimeSchema = (): CalendarEventDateTimeSchema =>
  z
    .object({
      dateTime: z.string().optional(),
      date: z.string().optional(),
      timeZone: z.string().optional(),
    })
    .strict();

export const calendarEventDateTimeSchema = createCalendarEventDateTimeSchema();

export const calendarCreateEventInputSchema = z
  .object({
    summary: z.string(),
    description: z.string().optional(),
    location: z.string().optional(),
    start: createCalendarEventDateTimeSchema(),
    end: createCalendarEventDateTimeSchema(),
    attendees: z.array(z.object({ email: z.string() }).strict()).optional(),
  })
  .strict();

export const calendarCreateEventRequestSchema = z
  .object({
    userId: z.string(),
    calendarId: z.string().optional(),
    event: calendarCreateEventInputSchema,
  })
  .strict();

const calendarEventAttendeeSchema = z
  .object({
    email: z.string().optional(),
    id: z.string().optional(),
    displayName: z.string().optional(),
    comment: z.string().optional(),
    additionalGuests: z.number().int().optional(),
    self: z.boolean().optional(),
    organizer: z.boolean().optional(),
    resource: z.boolean().optional(),
    responseStatus: z.enum(['needsAction', 'declined', 'tentative', 'accepted']).optional(),
    optional: z.boolean().optional(),
  })
  .strict();

export const calendarCreatedEventSchema = z
  .object({
    id: z.string(),
    summary: z.string(),
    description: z.string().optional(),
    location: z.string().optional(),
    start: createCalendarEventDateTimeSchema(),
    end: createCalendarEventDateTimeSchema(),
    status: z.enum(['confirmed', 'tentative', 'cancelled']).optional(),
    htmlLink: z.string().optional(),
    created: z.string().optional(),
    updated: z.string().optional(),
    organizer: z
      .object({
        email: z.string().optional(),
        displayName: z.string().optional(),
        self: z.boolean().optional(),
      })
      .strict()
      .optional(),
    attendees: z.array(calendarEventAttendeeSchema).optional(),
  })
  .strict();

export const calendarCreateEventDataSchema = z
  .object({
    event: calendarCreatedEventSchema,
  })
  .strict();

export const calendarCreateEventResponseSchema = createApiSuccessEnvelopeSchema(
  calendarCreateEventDataSchema
);

export const calendarUpdateEventAttendeesRequestSchema = z
  .object({
    userId: z.string(),
    calendarId: z.string().trim().min(1),
    expectedEtag: z.string().trim().min(1),
    attendeesToAdd: z
      .array(
        z
          .object({
            email: z.string().email(),
          })
          .strict()
      )
      .min(1),
  })
  .strict();

export const calendarUpdateEventAttendeesDataSchema = z
  .object({
    event: calendarCreatedEventSchema,
  })
  .strict();

export const calendarUpdateEventAttendeesResponseSchema = createApiSuccessEnvelopeSchema(
  calendarUpdateEventAttendeesDataSchema
);

const calendarUpdateEventAttendeeEmailSchema = z
  .object({
    email: z.string().email(),
  })
  .strict();

export const calendarUpdateEventChangesSchema = z
  .object({
    summary: z.string().trim().min(1).optional(),
    description: z.string().nullable().optional(),
    location: z.string().nullable().optional(),
    start: createCalendarEventDateTimeSchema().optional(),
    end: createCalendarEventDateTimeSchema().optional(),
    attendeesToAdd: z.array(calendarUpdateEventAttendeeEmailSchema).min(1).optional(),
    attendeesToRemove: z.array(calendarUpdateEventAttendeeEmailSchema).min(1).optional(),
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
    const startKind = calendarDateTimeKind(changes.start);
    const endKind = calendarDateTimeKind(changes.end);
    if (startKind === null || endKind === null || startKind !== endKind) {
      context.addIssue({
        code: 'custom',
        message: 'Calendar event start and end must use the same valid date type',
      });
    }
  });

export const calendarUpdateEventRequestSchema = z
  .object({
    userId: z.string(),
    calendarId: z.string().trim().min(1),
    expectedEtag: z.string().trim().min(1),
    changes: calendarUpdateEventChangesSchema,
  })
  .strict();

export const calendarUpdateEventDataSchema = z
  .object({
    event: calendarCreatedEventSchema,
  })
  .strict();

export const calendarUpdateEventResponseSchema = createApiSuccessEnvelopeSchema(
  calendarUpdateEventDataSchema
);

function calendarDateTimeKind(
  value: z.infer<typeof calendarEventDateTimeSchema>
): 'date' | 'dateTime' | null {
  const hasDate = typeof value.date === 'string' && value.date.trim() !== '';
  const hasDateTime = typeof value.dateTime === 'string' && value.dateTime.trim() !== '';
  if (hasDate === hasDateTime) return null;
  return hasDate ? 'date' : 'dateTime';
}

const createIsoDateTimeStringSchema = (): z.ZodString => z.string().datetime({ offset: true });

export const calendarListEventsRequestSchema = z
  .object({
    userId: z.string(),
    calendarId: z.string().optional(),
    timeMin: createIsoDateTimeStringSchema(),
    timeMax: createIsoDateTimeStringSchema(),
    maxResults: z.number().int().min(1).max(2500).optional(),
    q: z.string().optional(),
  })
  .strict();

export const calendarListEventSchema = z
  .object({
    id: z.string(),
    etag: z.string().optional(),
    summary: z.string(),
    location: z.string().optional(),
    start: createCalendarEventDateTimeSchema(),
    end: createCalendarEventDateTimeSchema(),
    htmlLink: z.string().optional(),
  })
  .strict();

export const calendarListEventsDataSchema = z
  .object({
    events: z.array(calendarListEventSchema),
    truncated: z.boolean(),
  })
  .strict();

export const calendarListEventsResponseSchema = createApiSuccessEnvelopeSchema(
  calendarListEventsDataSchema
);

export const calendarPreviewSchema = z
  .object({
    actionId: z.string(),
    userId: z.string(),
    status: z.enum(['pending', 'ready', 'failed']),
    summary: z.string().optional(),
    start: z.string().optional(),
    end: z.string().nullable().optional(),
    location: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    duration: z.string().nullable().optional(),
    isAllDay: z.boolean().optional(),
    error: z.string().optional(),
    reasoning: z.string().optional(),
    generatedAt: z.string(),
  })
  .strict();

export const calendarPreviewDataSchema = z
  .object({
    preview: calendarPreviewSchema.nullable(),
  })
  .strict();

export const calendarPreviewResponseSchema =
  createApiSuccessEnvelopeSchema(calendarPreviewDataSchema);

export const calendarPreviewEnvelopeSchema = z.union([
  calendarPreviewResponseSchema,
  apiErrorEnvelopeZodSchema,
]);

export const calendarGeneratePreviewRequestSchema = z
  .object({
    actionId: z.string(),
    userId: z.string(),
    text: z.string(),
    currentDate: z.string(),
  })
  .strict();

export type CalendarProcessActionRequest = z.infer<typeof calendarProcessActionRequestSchema>;
export type CalendarEventDateTime = z.infer<typeof calendarEventDateTimeSchema>;
export type CalendarCreateEventInput = z.infer<typeof calendarCreateEventInputSchema>;
export type CalendarCreateEventRequest = z.infer<typeof calendarCreateEventRequestSchema>;
export type CalendarCreatedEvent = z.infer<typeof calendarCreatedEventSchema>;
export type CalendarCreateEventData = z.infer<typeof calendarCreateEventDataSchema>;
export type CalendarCreateEventResponse = z.infer<typeof calendarCreateEventResponseSchema>;
export type CalendarUpdateEventAttendeesRequest = z.infer<
  typeof calendarUpdateEventAttendeesRequestSchema
>;
export type CalendarUpdateEventAttendeesData = z.infer<
  typeof calendarUpdateEventAttendeesDataSchema
>;
export type CalendarUpdateEventAttendeesResponse = z.infer<
  typeof calendarUpdateEventAttendeesResponseSchema
>;
export type CalendarUpdateEventChanges = z.infer<typeof calendarUpdateEventChangesSchema>;
export type CalendarUpdateEventRequest = z.infer<typeof calendarUpdateEventRequestSchema>;
export type CalendarUpdateEventData = z.infer<typeof calendarUpdateEventDataSchema>;
export type CalendarUpdateEventResponse = z.infer<typeof calendarUpdateEventResponseSchema>;
export type CalendarListEventsRequest = z.infer<typeof calendarListEventsRequestSchema>;
export type CalendarListEvent = z.infer<typeof calendarListEventSchema>;
export type CalendarListEventsData = z.infer<typeof calendarListEventsDataSchema>;
export type CalendarListEventsResponse = z.infer<typeof calendarListEventsResponseSchema>;
export type CalendarPreview = z.infer<typeof calendarPreviewSchema>;
export type CalendarPreviewData = z.infer<typeof calendarPreviewDataSchema>;
export type CalendarPreviewResponse = z.infer<typeof calendarPreviewResponseSchema>;
export type CalendarPreviewEnvelope = z.infer<typeof calendarPreviewEnvelopeSchema>;
export type CalendarGeneratePreviewRequest = z.infer<typeof calendarGeneratePreviewRequestSchema>;
