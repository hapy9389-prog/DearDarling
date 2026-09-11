import { Router } from 'express';
import type { Pool } from 'pg';
import { createUser } from '../repositories/usersRepository';

/**
 * 로컬 테스트 모드 전용 — app.ts는 localTestAuth가 true일 때만 이 라우터를 마운트한다.
 * 실제 가입(Cognito 연동)이 생기기 전까지 초대·프로필·동의 로직을 exercising하기 위한
 * 임시 진입점이며, 배포 설정에서는 라우트 자체가 존재하지 않는다.
 */
export function createTestUsersRouter(pool: Pool): Router {
  const router = Router();

  router.post('/users', async (req, res, next) => {
    try {
      const email = String(req.body?.email ?? '')
        .trim()
        .toLowerCase();
      if (!email) {
        res.status(400).json({ error: 'email-required' });
        return;
      }
      const user = await createUser(pool, email);
      res.status(201).json(user);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
