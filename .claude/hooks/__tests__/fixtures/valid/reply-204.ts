// Test fixture: 204 No Content (should pass - HTTP spec exception)
import { FastifyReply } from 'fastify';

export async function handler(reply: FastifyReply) {
  reply.status(204).send();
}
