// Test fixture: Proper reply.ok() usage (should pass)
import { FastifyReply } from 'fastify';

export async function handler(reply: FastifyReply) {
  return reply.ok({ data: 'proper response' });
}
