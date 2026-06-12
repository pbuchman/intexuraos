import { z } from 'zod';
import { createApiSuccessEnvelopeSchema } from './common.js';

export const commandsCommandWithTextSchema = z
  .object({
    id: z.string(),
    text: z.string(),
    sourceType: z.string(),
  })
  .strict();

export const commandsGetCommandDataSchema = z
  .object({
    command: commandsCommandWithTextSchema,
  })
  .strict();

export const commandsGetCommandResponseSchema = createApiSuccessEnvelopeSchema(
  commandsGetCommandDataSchema
);

export type CommandsCommandWithText = z.infer<typeof commandsCommandWithTextSchema>;
export type CommandsGetCommandData = z.infer<typeof commandsGetCommandDataSchema>;
export type CommandsGetCommandResponse = z.infer<typeof commandsGetCommandResponseSchema>;
