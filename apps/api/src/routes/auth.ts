import { Router, type Request } from 'express';
import type { Pool } from 'pg';
import { requireAuth } from '../middleware/testAuth';
import { createRateLimiter } from '../middleware/rateLimit';
import { setSessionCookie, clearSessionCookie } from '../http/sessionCookie';
import { validateEmail, validatePassword, normalizeEmail } from '../domain/auth';
import { classifyCognitoRejectionCode, safeRouteLabel } from '../logging/safeError';
import {
  AuthPortRejectedError,
  AuthPortTimeoutError,
  type CognitoAuthPort,
} from '../cognito/authPort';
import {
  login,
  signUp,
  confirmSignUp,
  resendConfirmationCode,
  requestForgotPassword,
  confirmForgotPassword,
  logout,
  logoutAll,
  AuthConflictError,
} from '../services/authService';

const TEN_MINUTES_MS = 10 * 60 * 1000;
const ONE_MINUTE_MS = 60 * 1000;

function emailKey(req: Request): string {
  const raw = req.body?.email;
  return typeof raw === 'string' && raw ? normalizeEmail(raw) : 'no-email';
}

/**
 * 6개 엔드포인트 전부에 요청 출처(IP)와 대상 이메일, 두 기준으로 요청 제한을 건다(계획 §4) —
 * IP 기준은 한 출처가 서로 다른 계정을 대량으로 시도하는 것을, 이메일 기준은 여러 출처가 같은
 * 계정을 대상으로 몰아치는 것을 각각 막는다. 어느 쪽도 계정 자체를 잠그지 않는다(카운터만 쌓일
 * 뿐, 정상적인 로그인·가입을 영구히 막지 않는다). `resend-confirmation`엔 이메일당 1분에 1회로
 * 좁힌 별도 제한을 추가해 "인증 메일 재전송 간격 제한"을 반영한다.
 * `/logout`·`/logout-all`은 세션이 이미 있는 요청이라 여기 포함하지 않는다.
 */
export function createAuthRouter(
  pool: Pool,
  authPort: CognitoAuthPort,
  tokenEncryptionKey: Buffer | undefined,
): Router {
  const router = Router();

  const limitByIp = (scope: string, limit: number) =>
    createRateLimiter(pool, { scope, limit, windowMs: TEN_MINUTES_MS });
  const limitByEmail = (scope: string, limit: number, windowMs = TEN_MINUTES_MS) =>
    createRateLimiter(pool, { scope, limit, windowMs, keyFn: emailKey });

  router.post(
    '/signup',
    limitByIp('auth-signup-ip', 10),
    limitByEmail('auth-signup-email', 5),
    async (req, res, next) => {
      try {
        const email = typeof req.body?.email === 'string' ? req.body.email : '';
        const password = typeof req.body?.password === 'string' ? req.body.password : '';
        const emailCheck = validateEmail(email);
        if (!emailCheck.ok) {
          res.status(400).json({ error: 'invalid-email', message: emailCheck.message });
          return;
        }
        const passwordCheck = validatePassword(password);
        if (!passwordCheck.ok) {
          res.status(400).json({ error: 'invalid-password', message: passwordCheck.message });
          return;
        }
        await signUp(authPort, email, password);
        // 로컬 DB엔 아무것도 만들지 않는다 — 사용자 행은 첫 로그인 시점에 생긴다.
        res.status(200).json({ ok: true });
      } catch (err) {
        if (err instanceof AuthPortRejectedError) {
          // 진단용 로그 — requestId·고정 라우트명·상태·허용목록에 있는 Cognito 오류 이름만
          // 남긴다. 이메일·비밀번호·err.message(Cognito가 돌려준 원문일 수 있다)는 남기지 않는다.
          console.error('[auth:signup]', {
            requestId: req.requestId,
            route: safeRouteLabel(req),
            status: 400,
            cognitoError: classifyCognitoRejectionCode(err.code),
          });
          res.status(400).json({ error: 'signup-rejected' });
          return;
        }
        if (err instanceof AuthPortTimeoutError) {
          // Cognito 쪽에서 실제로는 가입이 됐을 수도, 안 됐을 수도 있다 — 실패로 단정하지 않는다.
          // 이 경우는 특정 Cognito 예외로 확정되지 않은 상태(타임아웃·연결 끊김 등)라 이름 자체가
          // 없다 — 'timeout'으로 고정해 남긴다.
          console.error('[auth:signup]', {
            requestId: req.requestId,
            route: safeRouteLabel(req),
            status: 202,
            cognitoError: 'timeout',
          });
          res.status(202).json({
            status: 'unknown',
            message:
              '가입 요청 결과를 확인하지 못했습니다. 잠시 후 로그인을 시도하거나 다시 가입해 주세요.',
          });
          return;
        }
        next(err);
      }
    },
  );

  router.post(
    '/confirm-signup',
    limitByIp('auth-confirm-signup-ip', 10),
    limitByEmail('auth-confirm-signup-email', 10),
    async (req, res, next) => {
      try {
        const email = typeof req.body?.email === 'string' ? req.body.email : '';
        const code = typeof req.body?.code === 'string' ? req.body.code : '';
        if (!email || !code) {
          res.status(400).json({ error: 'invalid-input' });
          return;
        }
        await confirmSignUp(authPort, email, code);
        res.status(200).json({ ok: true });
      } catch (err) {
        if (err instanceof AuthPortRejectedError) {
          res.status(400).json({ error: 'invalid-code' });
          return;
        }
        if (err instanceof AuthPortTimeoutError) {
          res.status(202).json({
            status: 'unknown',
            message:
              '확인 결과를 받지 못했습니다. 잠시 후 로그인을 시도해 보거나 다시 확인해 주세요.',
          });
          return;
        }
        next(err);
      }
    },
  );

  router.post(
    '/resend-confirmation',
    limitByIp('auth-resend-confirmation-ip', 5),
    // 인증 메일 재전송 간격 제한 — 같은 이메일로는 1분에 한 번만.
    limitByEmail('auth-resend-confirmation-interval', 1, ONE_MINUTE_MS),
    async (req, res) => {
      try {
        const email = typeof req.body?.email === 'string' ? req.body.email : '';
        if (!email) {
          res.status(400).json({ error: 'invalid-input' });
          return;
        }
        await resendConfirmationCode(authPort, email);
        res.status(200).json({ ok: true });
      } catch {
        // 계정 존재 여부·통신 오류 종류를 노출하지 않는다 — forgot-password와 같은 원칙으로
        // 항상 같은 응답을 보낸다(실패했어도 재시도 자체는 요청 제한이 막아 준다).
        res.status(200).json({ ok: true });
      }
    },
  );

  router.post(
    '/login',
    limitByIp('auth-login-ip', 20),
    limitByEmail('auth-login-email', 10),
    async (req, res, next) => {
      try {
        const email = typeof req.body?.email === 'string' ? req.body.email : '';
        const password = typeof req.body?.password === 'string' ? req.body.password : '';
        if (!email || !password) {
          res.status(400).json({ error: 'invalid-input' });
          return;
        }
        const result = await login(
          pool,
          authPort,
          tokenEncryptionKey,
          email,
          password,
          req.header('user-agent') ?? null,
        );
        setSessionCookie(res, result.sessionId, result.sessionExpiresAt);
        res.status(200).json({ ok: true });
      } catch (err) {
        if (err instanceof AuthConflictError) {
          res.status(409).json({ error: 'conflict', message: err.message });
          return;
        }
        if (err instanceof AuthPortRejectedError) {
          res.status(401).json({ error: 'invalid-credentials' });
          return;
        }
        if (err instanceof AuthPortTimeoutError) {
          // 자격 증명이 맞는지조차 확인 못 했다 — "틀렸다"(401)고 단정하지 않는다.
          res.status(503).json({
            error: 'auth-unavailable',
            message: '로그인 처리 결과를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.',
          });
          return;
        }
        next(err);
      }
    },
  );

  router.post(
    '/forgot-password',
    limitByIp('auth-forgot-password-ip', 10),
    limitByEmail('auth-forgot-password-email', 5),
    async (req, res, next) => {
      try {
        const email = typeof req.body?.email === 'string' ? req.body.email : '';
        if (!email) {
          res.status(400).json({ error: 'invalid-input' });
          return;
        }
        await requestForgotPassword(authPort, email);
        // 계정 존재 여부와 무관하게 항상 같은 응답.
        res.status(200).json({ ok: true });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/confirm-forgot-password',
    limitByIp('auth-confirm-forgot-password-ip', 10),
    limitByEmail('auth-confirm-forgot-password-email', 5),
    async (req, res, next) => {
      try {
        const email = typeof req.body?.email === 'string' ? req.body.email : '';
        const code = typeof req.body?.code === 'string' ? req.body.code : '';
        const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';
        if (!email || !code) {
          res.status(400).json({ error: 'invalid-input' });
          return;
        }
        const passwordCheck = validatePassword(newPassword);
        if (!passwordCheck.ok) {
          res.status(400).json({ error: 'invalid-password', message: passwordCheck.message });
          return;
        }
        const outcome = await confirmForgotPassword(pool, authPort, email, code, newPassword);
        if (outcome === 'rejected') {
          res.status(401).json({ error: 'invalid-code' });
          return;
        }
        if (outcome === 'unknown') {
          // 성공도 실패도 단정하지 않는다(계획 §3-4 케이스 C) — assumed는 비밀번호 변경 성공을
          // 뜻하지 않는다: 재로그인(기존 비밀번호가 여전히 유효할 수 있음) 또는 재설정 재시도
          // 둘 다 안내한다. 성공을 단정하는 문구를 쓰지 않는다.
          res.status(202).json({
            status: 'unknown',
            message:
              '요청 처리 결과를 확인하지 못했습니다. 잠시 후 이전 비밀번호로 로그인해 보거나, ' +
              '그래도 안 되면 비밀번호 재설정을 다시 시도해 주세요.',
          });
          return;
        }
        if (outcome === 'confirmed-local-pending') {
          // Cognito는 비밀번호 변경을 확인했지만, 그 직후 로컬 차단 처리(T1)가 이 요청 안에서
          // 끝나지 못했다 — 그래도 그 사실(recovery 행)은 이미 durable하게 남아 있어 정리
          // 루틴이 이어받는다. "완료됐다"고 단정하지 않되, 실패로도 보이지 않게 구분한다.
          res.status(200).json({
            status: 'confirmed-local-pending',
            message:
              '비밀번호가 변경됐습니다. 다른 기기의 로그인 세션 종료 처리가 아직 완료되지 ' +
              '않았습니다 — 잠시 후 다시 확인해 주세요.',
          });
          return;
        }
        res.status(200).json({ status: outcome });
      } catch (err) {
        next(err);
      }
    },
  );

  router.get('/me', async (req, res) => {
    // 세션 인증 미들웨어(sessionAuthMiddleware)가 이미 req.userId를 채워 뒀다 — 여기서는 그
    // 결과만 읽는다. 비밀정보(이메일·닉네임 등)는 반환하지 않는다 — 그건 /api/profile의 역할이다.
    if (!req.userId) {
      res.status(200).json({ authenticated: false });
      return;
    }
    res.status(200).json({ authenticated: true, userId: req.userId });
  });

  router.post('/logout', requireAuth, async (req, res, next) => {
    try {
      if (req.sessionId) await logout(pool, req.sessionId);
      clearSessionCookie(res);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  router.post('/logout-all', requireAuth, async (req, res, next) => {
    try {
      await logoutAll(pool, req.userId!);
      clearSessionCookie(res);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
