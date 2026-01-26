/**
 * Tests for WhatsApp phone verification routes:
 * - POST /whatsapp/verify/send
 * - POST /whatsapp/verify/confirm
 * - GET /whatsapp/verify/status/:phone
 */
import { createToken, describe, expect, it, setupTestContext, beforeEach } from './testUtils.js';
import { FakeMessageSender } from './fakes.js';
import { setServices, getServices, resetServices } from '../services.js';

describe('WhatsApp Verification Routes', () => {
  const ctx = setupTestContext();
  let messageSender: FakeMessageSender;

  beforeEach(() => {
    messageSender = new FakeMessageSender();
    const services = getServices();
    setServices({
      ...services,
      messageSender,
    });
  });

  describe('POST /whatsapp/verify/send', () => {
    it('returns 401 when no authorization header', async () => {
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/whatsapp/verify/send',
        payload: {
          phoneNumber: '+12125551234',
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 400 when phoneNumber is missing', async () => {
      const token = await createToken({ sub: 'user-123' });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/whatsapp/verify/send',
        headers: { authorization: `Bearer ${token}` },
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_REQUEST');
    });

    it('returns 400 when phone number format is invalid', async () => {
      const token = await createToken({ sub: 'user-123' });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/whatsapp/verify/send',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          phoneNumber: 'not-a-phone',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_REQUEST');
    });

    it('returns 409 when phone is already verified', async () => {
      const token = await createToken({ sub: 'user-verified' });

      ctx.phoneVerificationRepository.setVerification({
        id: 'existing-verified',
        userId: 'user-verified',
        phoneNumber: '12125551234',
        code: '123456',
        attempts: 0,
        status: 'verified',
        createdAt: new Date().toISOString(),
        expiresAt: Math.floor(Date.now() / 1000) + 600,
        verifiedAt: new Date().toISOString(),
      });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/whatsapp/verify/send',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          phoneNumber: '+12125551234',
        },
      });

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('CONFLICT');
      expect(body.error.message).toContain('already verified');
    });

    it('returns 429 when resend cooldown is active', async () => {
      const token = await createToken({ sub: 'user-cooldown' });

      ctx.phoneVerificationRepository.setVerification({
        id: 'existing-pending',
        userId: 'user-cooldown',
        phoneNumber: '12125559999',
        code: '654321',
        attempts: 0,
        status: 'pending',
        createdAt: new Date().toISOString(),
        expiresAt: Math.floor(Date.now() / 1000) + 600,
      });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/whatsapp/verify/send',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          phoneNumber: '+12125559999',
        },
      });

      expect(response.statusCode).toBe(429);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string; details?: { cooldownUntil?: number } };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('RATE_LIMITED');
      expect(body.error.details?.cooldownUntil).toBeDefined();
    });

    it('allows resend after cooldown expires', async () => {
      const token = await createToken({ sub: 'user-resend' });
      const oldCreatedAt = new Date(Date.now() - 120000).toISOString();

      ctx.phoneVerificationRepository.setVerification({
        id: 'old-pending',
        userId: 'user-resend',
        phoneNumber: '12125558888',
        code: '111111',
        attempts: 0,
        status: 'pending',
        createdAt: oldCreatedAt,
        expiresAt: Math.floor(Date.now() / 1000) + 600,
      });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/whatsapp/verify/send',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          phoneNumber: '+12125558888',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { verificationId: string };
      };
      expect(body.success).toBe(true);
      expect(body.data.verificationId).toBeDefined();
    });

    it('returns 429 when max requests per hour exceeded', async () => {
      const token = await createToken({ sub: 'user-rate-limit' });
      const now = new Date();

      for (let i = 0; i < 3; i++) {
        ctx.phoneVerificationRepository.setVerification({
          id: `rate-limit-${String(i)}`,
          userId: `other-user-${String(i)}`,
          phoneNumber: '12125557777',
          code: '000000',
          attempts: 0,
          status: 'expired',
          createdAt: new Date(now.getTime() - i * 1000).toISOString(),
          expiresAt: Math.floor(now.getTime() / 1000) - 1,
        });
      }

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/whatsapp/verify/send',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          phoneNumber: '+12125557777',
        },
      });

      expect(response.statusCode).toBe(429);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('RATE_LIMITED');
      expect(body.error.message).toContain('Too many');
    });

    it('sends verification code successfully', async () => {
      const token = await createToken({ sub: 'user-success' });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/whatsapp/verify/send',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          phoneNumber: '+12125551111',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { verificationId: string; expiresAt: number; cooldownUntil: number };
      };
      expect(body.success).toBe(true);
      expect(body.data.verificationId).toBeDefined();
      expect(body.data.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
      expect(body.data.cooldownUntil).toBeDefined();

      const sentMessages = messageSender.getSentMessages();
      expect(sentMessages.length).toBe(1);
      expect(sentMessages[0]?.phoneNumber).toBe('+12125551111');
      expect(sentMessages[0]?.message).toContain('verification code');
    });

    it('returns 502 when isPhoneVerified fails', async () => {
      const token = await createToken({ sub: 'user-db-error' });
      ctx.phoneVerificationRepository.setFail(true);

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/whatsapp/verify/send',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          phoneNumber: '+12125552222',
        },
      });

      expect(response.statusCode).toBe(502);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('DOWNSTREAM_ERROR');
    });

    it('returns 502 when sending message fails and marks verification as expired', async () => {
      const token = await createToken({ sub: 'user-send-fail' });
      messageSender.setFail(true);

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/whatsapp/verify/send',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          phoneNumber: '+12125553333',
        },
      });

      expect(response.statusCode).toBe(502);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('DOWNSTREAM_ERROR');
      expect(body.error.message).toContain('Failed to send');
    });

    it('returns 502 when findPendingByUserAndPhone fails', async () => {
      const token = await createToken({ sub: 'user-pending-fail' });
      ctx.phoneVerificationRepository.setFailFindPending(true);

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/whatsapp/verify/send',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          phoneNumber: '+12125554001',
        },
      });

      expect(response.statusCode).toBe(502);
    });

    it('returns 502 when countRecentByPhone fails', async () => {
      const token = await createToken({ sub: 'user-count-fail' });
      ctx.phoneVerificationRepository.setFailCountRecent(true);

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/whatsapp/verify/send',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          phoneNumber: '+12125554003',
        },
      });

      expect(response.statusCode).toBe(502);
    });

    it('returns 502 when create fails', async () => {
      const token = await createToken({ sub: 'user-create-fail' });
      ctx.phoneVerificationRepository.setFailCreate(true);

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/whatsapp/verify/send',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          phoneNumber: '+12125554004',
        },
      });

      expect(response.statusCode).toBe(502);
    });
  });

  describe('POST /whatsapp/verify/confirm', () => {
    it('returns 401 when no authorization header', async () => {
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/whatsapp/verify/confirm',
        payload: {
          verificationId: 'some-id',
          code: '123456',
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 400 when verificationId is missing', async () => {
      const token = await createToken({ sub: 'user-123' });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/whatsapp/verify/confirm',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          code: '123456',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_REQUEST');
    });

    it('returns 400 when code is wrong length', async () => {
      const token = await createToken({ sub: 'user-123' });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/whatsapp/verify/confirm',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          verificationId: 'some-id',
          code: '12345',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_REQUEST');
    });

    it('returns 404 when verification not found', async () => {
      const token = await createToken({ sub: 'user-123' });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/whatsapp/verify/confirm',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          verificationId: 'nonexistent-id',
          code: '123456',
        },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('returns 404 when verification belongs to different user', async () => {
      const token = await createToken({ sub: 'user-wrong' });

      ctx.phoneVerificationRepository.setVerification({
        id: 'other-user-verification',
        userId: 'user-correct',
        phoneNumber: '12125551234',
        code: '123456',
        attempts: 0,
        status: 'pending',
        createdAt: new Date().toISOString(),
        expiresAt: Math.floor(Date.now() / 1000) + 600,
      });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/whatsapp/verify/confirm',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          verificationId: 'other-user-verification',
          code: '123456',
        },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('returns 409 when phone is already verified', async () => {
      const token = await createToken({ sub: 'user-already-verified' });

      ctx.phoneVerificationRepository.setVerification({
        id: 'already-verified',
        userId: 'user-already-verified',
        phoneNumber: '12125554444',
        code: '999999',
        attempts: 0,
        status: 'verified',
        createdAt: new Date().toISOString(),
        expiresAt: Math.floor(Date.now() / 1000) + 600,
        verifiedAt: new Date().toISOString(),
      });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/whatsapp/verify/confirm',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          verificationId: 'already-verified',
          code: '999999',
        },
      });

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('CONFLICT');
    });

    it('returns 423 when verification has max_attempts status', async () => {
      const token = await createToken({ sub: 'user-max-attempts' });

      ctx.phoneVerificationRepository.setVerification({
        id: 'max-attempts-verification',
        userId: 'user-max-attempts',
        phoneNumber: '12125555555',
        code: '888888',
        attempts: 3,
        status: 'max_attempts',
        createdAt: new Date().toISOString(),
        expiresAt: Math.floor(Date.now() / 1000) + 600,
      });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/whatsapp/verify/confirm',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          verificationId: 'max-attempts-verification',
          code: '888888',
        },
      });

      expect(response.statusCode).toBe(423);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('LOCKED');
    });

    it('returns 410 when verification has expired status', async () => {
      const token = await createToken({ sub: 'user-expired-status' });

      ctx.phoneVerificationRepository.setVerification({
        id: 'expired-status-verification',
        userId: 'user-expired-status',
        phoneNumber: '12125556666',
        code: '777777',
        attempts: 0,
        status: 'expired',
        createdAt: new Date().toISOString(),
        expiresAt: Math.floor(Date.now() / 1000) + 600,
      });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/whatsapp/verify/confirm',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          verificationId: 'expired-status-verification',
          code: '777777',
        },
      });

      expect(response.statusCode).toBe(410);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('GONE');
    });

    it('returns 410 when verification has expired by time', async () => {
      const token = await createToken({ sub: 'user-expired-time' });

      ctx.phoneVerificationRepository.setVerification({
        id: 'expired-time-verification',
        userId: 'user-expired-time',
        phoneNumber: '12125557777',
        code: '666666',
        attempts: 0,
        status: 'pending',
        createdAt: new Date(Date.now() - 700000).toISOString(),
        expiresAt: Math.floor(Date.now() / 1000) - 100,
      });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/whatsapp/verify/confirm',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          verificationId: 'expired-time-verification',
          code: '666666',
        },
      });

      expect(response.statusCode).toBe(410);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('GONE');
    });

    it('returns 423 when max attempts reached during confirm', async () => {
      const token = await createToken({ sub: 'user-reaching-max' });

      ctx.phoneVerificationRepository.setVerification({
        id: 'reaching-max-verification',
        userId: 'user-reaching-max',
        phoneNumber: '12125558888',
        code: '555555',
        attempts: 3,
        status: 'pending',
        createdAt: new Date().toISOString(),
        expiresAt: Math.floor(Date.now() / 1000) + 600,
      });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/whatsapp/verify/confirm',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          verificationId: 'reaching-max-verification',
          code: '999999',
        },
      });

      expect(response.statusCode).toBe(423);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('LOCKED');
    });

    it('returns 400 with remaining attempts when code is wrong', async () => {
      const token = await createToken({ sub: 'user-wrong-code' });

      ctx.phoneVerificationRepository.setVerification({
        id: 'wrong-code-verification',
        userId: 'user-wrong-code',
        phoneNumber: '12125559999',
        code: '444444',
        attempts: 0,
        status: 'pending',
        createdAt: new Date().toISOString(),
        expiresAt: Math.floor(Date.now() / 1000) + 600,
      });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/whatsapp/verify/confirm',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          verificationId: 'wrong-code-verification',
          code: '111111',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string; details?: { remainingAttempts?: number } };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_REQUEST');
      expect(body.error.message).toContain('Invalid verification code');
      expect(body.error.details?.remainingAttempts).toBe(2);
    });

    it('locks verification after 3 wrong attempts', async () => {
      const token = await createToken({ sub: 'user-lock-out' });

      ctx.phoneVerificationRepository.setVerification({
        id: 'lockout-verification',
        userId: 'user-lock-out',
        phoneNumber: '12125550000',
        code: '333333',
        attempts: 2,
        status: 'pending',
        createdAt: new Date().toISOString(),
        expiresAt: Math.floor(Date.now() / 1000) + 600,
      });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/whatsapp/verify/confirm',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          verificationId: 'lockout-verification',
          code: '000000',
        },
      });

      expect(response.statusCode).toBe(423);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('LOCKED');
    });

    it('verifies code successfully', async () => {
      const token = await createToken({ sub: 'user-verify-success' });

      ctx.phoneVerificationRepository.setVerification({
        id: 'success-verification',
        userId: 'user-verify-success',
        phoneNumber: '12125551212',
        code: '222222',
        attempts: 0,
        status: 'pending',
        createdAt: new Date().toISOString(),
        expiresAt: Math.floor(Date.now() / 1000) + 600,
      });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/whatsapp/verify/confirm',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          verificationId: 'success-verification',
          code: '222222',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { phoneNumber: string; verified: boolean; verifiedAt: string };
      };
      expect(body.success).toBe(true);
      expect(body.data.phoneNumber).toBe('12125551212');
      expect(body.data.verified).toBe(true);
      expect(body.data.verifiedAt).toBeDefined();
    });

    it('returns 502 when findById fails', async () => {
      const token = await createToken({ sub: 'user-db-fail' });
      ctx.phoneVerificationRepository.setFail(true);

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/whatsapp/verify/confirm',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          verificationId: 'any-id',
          code: '123456',
        },
      });

      expect(response.statusCode).toBe(502);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('DOWNSTREAM_ERROR');
    });

    it('returns 502 when incrementAttempts fails', async () => {
      const token = await createToken({ sub: 'user-increment-fail' });

      ctx.phoneVerificationRepository.setVerification({
        id: 'increment-fail-verification',
        userId: 'user-increment-fail',
        phoneNumber: '12125559001',
        code: '111111',
        attempts: 0,
        status: 'pending',
        createdAt: new Date().toISOString(),
        expiresAt: Math.floor(Date.now() / 1000) + 600,
      });

      ctx.phoneVerificationRepository.setFailIncrementAttempts(true);

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/whatsapp/verify/confirm',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          verificationId: 'increment-fail-verification',
          code: '000000',
        },
      });

      expect(response.statusCode).toBe(502);
    });

    it('returns 502 when updateStatus fails on success path', async () => {
      const token = await createToken({ sub: 'user-update-fail' });

      ctx.phoneVerificationRepository.setVerification({
        id: 'update-fail-verification',
        userId: 'user-update-fail',
        phoneNumber: '12125559002',
        code: '222222',
        attempts: 0,
        status: 'pending',
        createdAt: new Date().toISOString(),
        expiresAt: Math.floor(Date.now() / 1000) + 600,
      });

      ctx.phoneVerificationRepository.setFailUpdateStatus(true);

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/whatsapp/verify/confirm',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          verificationId: 'update-fail-verification',
          code: '222222',
        },
      });

      expect(response.statusCode).toBe(502);
    });
  });

  describe('GET /whatsapp/verify/status/:phone', () => {
    it('returns 401 when no authorization header', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/whatsapp/verify/status/12125551234',
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 400 when phone is empty', async () => {
      const token = await createToken({ sub: 'user-123' });

      const response = await ctx.app.inject({
        method: 'GET',
        url: '/whatsapp/verify/status/%20',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_REQUEST');
    });

    it('returns verified=true when phone is verified', async () => {
      const token = await createToken({ sub: 'user-status-verified' });

      ctx.phoneVerificationRepository.setVerification({
        id: 'status-verified',
        userId: 'user-status-verified',
        phoneNumber: '12125551234',
        code: '123456',
        attempts: 0,
        status: 'verified',
        createdAt: new Date().toISOString(),
        expiresAt: Math.floor(Date.now() / 1000) + 600,
        verifiedAt: new Date().toISOString(),
      });

      const response = await ctx.app.inject({
        method: 'GET',
        url: '/whatsapp/verify/status/12125551234',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { phoneNumber: string; verified: boolean; pendingVerification: null };
      };
      expect(body.success).toBe(true);
      expect(body.data.phoneNumber).toBe('12125551234');
      expect(body.data.verified).toBe(true);
      expect(body.data.pendingVerification).toBeNull();
    });

    it('returns verified=false with pending when verification exists', async () => {
      const token = await createToken({ sub: 'user-status-pending' });

      ctx.phoneVerificationRepository.setVerification({
        id: 'status-pending',
        userId: 'user-status-pending',
        phoneNumber: '12125555555',
        code: '654321',
        attempts: 1,
        status: 'pending',
        createdAt: new Date().toISOString(),
        expiresAt: Math.floor(Date.now() / 1000) + 600,
      });

      const response = await ctx.app.inject({
        method: 'GET',
        url: '/whatsapp/verify/status/12125555555',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: {
          phoneNumber: string;
          verified: boolean;
          pendingVerification: { id: string; expiresAt: number; attemptsRemaining: number };
        };
      };
      expect(body.success).toBe(true);
      expect(body.data.phoneNumber).toBe('12125555555');
      expect(body.data.verified).toBe(false);
      expect(body.data.pendingVerification.id).toBe('status-pending');
      expect(body.data.pendingVerification.attemptsRemaining).toBe(2);
    });

    it('returns verified=false with null pending when no verification', async () => {
      const token = await createToken({ sub: 'user-status-none' });

      const response = await ctx.app.inject({
        method: 'GET',
        url: '/whatsapp/verify/status/12125556666',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { phoneNumber: string; verified: boolean; pendingVerification: null };
      };
      expect(body.success).toBe(true);
      expect(body.data.phoneNumber).toBe('12125556666');
      expect(body.data.verified).toBe(false);
      expect(body.data.pendingVerification).toBeNull();
    });

    it('returns 502 when isPhoneVerified fails', async () => {
      const token = await createToken({ sub: 'user-status-error' });
      ctx.phoneVerificationRepository.setFail(true);

      const response = await ctx.app.inject({
        method: 'GET',
        url: '/whatsapp/verify/status/12125557777',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(502);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('DOWNSTREAM_ERROR');
    });

    it('normalizes phone number in URL', async () => {
      const token = await createToken({ sub: 'user-normalize' });

      ctx.phoneVerificationRepository.setVerification({
        id: 'normalize-verified',
        userId: 'user-normalize',
        phoneNumber: '12125558888',
        code: '123456',
        attempts: 0,
        status: 'verified',
        createdAt: new Date().toISOString(),
        expiresAt: Math.floor(Date.now() / 1000) + 600,
        verifiedAt: new Date().toISOString(),
      });

      const response = await ctx.app.inject({
        method: 'GET',
        url: '/whatsapp/verify/status/+12125558888',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { verified: boolean };
      };
      expect(body.success).toBe(true);
      expect(body.data.verified).toBe(true);
    });

    it('returns 502 when findPendingByUserAndPhone fails in status endpoint', async () => {
      const token = await createToken({ sub: 'user-pending-error' });
      ctx.phoneVerificationRepository.setFailFindPending(true);

      const response = await ctx.app.inject({
        method: 'GET',
        url: '/whatsapp/verify/status/12125559999',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(502);
    });
  });
});
