import { Router } from 'express';
import type { Pool } from 'pg';
import { recordConsentChange, listConsentHistory } from '../repositories/consentRepository';

export function createConsentRouter(pool: Pool): Router {
  const router = Router();

  router.get('/history', async (req, res, next) => {
    try {
      const history = await listConsentHistory(pool, req.userId!);
      res.json(history);
    } catch (err) {
      next(err);
    }
  });

  // 동의는 기본 꺼짐이고 가입·연결 어떤 흐름도 막지 않는다 — 이 라우트는 상태를 바꾸기만 한다.
  router.put('/', async (req, res, next) => {
    try {
      const granted = req.body?.granted;
      // Boolean(...)으로 강제 변환하지 않는다 — "false" 문자열, 0, null, 누락 등은
      // 전부 거부하고 아무 것도 바꾸지 않는다. 실제 true/false만 허용한다.
      if (typeof granted !== 'boolean') {
        res.status(400).json({ error: 'invalid-granted' });
        return;
      }
      const event = await recordConsentChange(pool, req.userId!, granted);
      res.json(event);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
