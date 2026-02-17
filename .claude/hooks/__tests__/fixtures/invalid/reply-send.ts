// Test fixture: Raw reply.send() in routes (should be blocked)
import { FastifyReply } from 'fastify';

export async function handler(reply: FastifyReply) {
  reply.send({ data: 'raw send' });
}
