import express from 'express';
import { spawn } from 'child_process';

const app = express();
const PORT = process.env.PORT || 8106;

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

const clients = new Set();

app.get('/logs', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  clients.add(res);
  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

  const pm2Stream = spawn('pm2', ['logs', '--json', '--raw'], {
    shell: true,
  });

  pm2Stream.stdout.on('data', (data) => {
    const lines = data.toString().split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const log = JSON.parse(line);
        res.write(`data: ${JSON.stringify({ type: 'log', log })}\n\n`);
      } catch {
        if (line.trim()) {
          res.write(
            `data: ${JSON.stringify({ type: 'log', log: { message: line, process: { name: 'unknown' } } })}\n\n`
          );
        }
      }
    }
  });

  pm2Stream.stderr.on('data', (data) => {
    const lines = data.toString().split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const log = JSON.parse(line);
        res.write(`data: ${JSON.stringify({ type: 'log', log })}\n\n`);
      } catch {
        if (line.trim()) {
          res.write(
            `data: ${JSON.stringify({ type: 'log', log: { message: line, process: { name: 'unknown' }, err: true } })}\n\n`
          );
        }
      }
    }
  });

  req.on('close', () => {
    clients.delete(res);
    pm2Stream.kill();
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', clients: clients.size });
});

app.listen(PORT, () => {
  console.log(`[Log Server] Running on http://localhost:${PORT}`);
  console.log(`[Log Server] SSE endpoint: http://localhost:${PORT}/logs`);
});
