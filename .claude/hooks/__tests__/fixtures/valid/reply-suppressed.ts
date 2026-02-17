// Test fixture: Suppressed raw send (should pass)
import { FastifyReply } from 'fastify';

export async function handler(reply: FastifyReply) {
  // @allow-raw-send -- webhook requires specific format
  reply.send({ webhook: 'format' });
}
