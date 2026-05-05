import type { FastifyReply, FastifyRequest } from 'fastify';
import { requireAuth, type AuthUser } from '@intexuraos/common-http';

export async function withAuth(
  request: FastifyRequest,
  reply: FastifyReply,
  handler: (user: AuthUser) => Promise<FastifyReply>
): Promise<FastifyReply> {
  const user = await requireAuth(request, reply);
  if (user === null) return await reply;
  return await handler(user);
}
