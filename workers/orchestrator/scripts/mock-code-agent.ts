/* eslint-disable */
import fastify from 'fastify';

const app = fastify();

app.post('/internal/webhooks/task-complete', async (request, reply) => {
  console.log('📬 Task complete webhook received:', JSON.stringify(request.body, null, 2));
  return { received: true, timestamp: new Date().toISOString() };
});

app.post('/internal/webhooks/log-chunk', async (request, reply) => {
  const body = request.body as { sequence: number; content: string; taskId: string };
  console.log(`📋 Log chunk [${body.sequence}]: ${body.content.length} bytes`);
  return { received: true };
});

app.listen({ port: 9090, host: '0.0.0.0' }, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`🤖 Mock code-agent listening on ${address}`);
});
