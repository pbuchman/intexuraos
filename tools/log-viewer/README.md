# Log Viewer

Standalone log viewer for IntexuraOS PM2 logs.

## Quick Start

```bash
cd tools/log-viewer
npm install
npm run dev
```

Opens at http://localhost:5173

## Requirements

- Log server running at http://localhost:8106 (started via `pm2 start` with main app)

## Features

- Real-time log streaming via SSE
- Filter by text, log level, or app
- Auto-follow mode (scroll to newest)
- Expand rows to see full JSON
- Copy raw log data

## Standalone

This tool has zero dependencies on the main monorepo. You can:

- Delete this folder anytime
- Run it independently with just `npm install && npm run dev`
- Move it anywhere
