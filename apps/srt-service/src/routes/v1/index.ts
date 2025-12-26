/**
 * Transcription Routes
 *
 * Route URL → Handler:
 * ─────────────────────────────────────────────────────────────
 * POST   /v1/transcribe           → Create transcription job
 * GET    /v1/transcribe/:jobId    → Get job status
 * ─────────────────────────────────────────────────────────────
 */

export { transcribeRoutes } from './transcribeRoutes.js';
export { v1Routes } from './routes.js';
