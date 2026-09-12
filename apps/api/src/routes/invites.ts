import { Router, type Request } from 'express';
import type { Pool } from 'pg';
import {
  createInvite,
  acceptInvite,
  previewInvite,
  revokeInvite,
  InviteAcceptFailure,
} from '../services/inviteService';
import { isValidCalendarDate } from '../domain/date';
import { createRateLimiter } from '../middleware/rateLimit';

const TEN_MINUTES_MS = 10 * 60 * 1000;

function userKey(req: Request): string {
  return req.userId ?? 'no-user';
}

export function createInvitesRouter(pool: Pool): Router {
  const router = Router();

  // 초대 코드 미리보기 반복 조회 제한 — IP 기준(한 출처가 여러 계정으로 코드를 무작위
  // 대입하는 것)과 계정 기준(한 계정이 여러 출처로 코드를 무작위 대입하는 것) 둘 다 막는다.
  // auth.ts의 limitByIp/limitByEmail과 동일한 패턴이다.
  const limitPreviewByIp = createRateLimiter(pool, {
    scope: 'invites-preview-ip',
    limit: 30,
    windowMs: TEN_MINUTES_MS,
  });
  const limitPreviewByUser = createRateLimiter(pool, {
    scope: 'invites-preview-user',
    limit: 20,
    windowMs: TEN_MINUTES_MS,
    keyFn: userKey,
  });

  router.get('/:code', limitPreviewByIp, limitPreviewByUser, async (req, res, next) => {
    try {
      // 이 라우트만 미들웨어를 두 개 거치는데, 그 조합에서는 express의 라우트 오버로드가
      // 경로 기반 파라미터 타입(:code → string)을 좁혀 주지 못하고 string | string[]로
      // 넓어진다(다른 :code 라우트는 미들웨어가 없어 문제없이 좁혀진다) — 실제 런타임 값은
      // 항상 string 하나다(같은 이름의 경로 세그먼트가 두 번 나올 수 없다).
      const code = req.params.code as string;
      const preview = await previewInvite(pool, code, req.userId!);
      res.status(200).json(preview);
    } catch (err) {
      if (err instanceof InviteAcceptFailure) {
        res.status(409).json({ error: err.reason });
        return;
      }
      next(err);
    }
  });

  router.post('/', async (req, res, next) => {
    try {
      // 이미 활성 초대가 있으면 새로 만들지 않고 그걸 그대로 돌려주므로(멱등), 새로 만들었는지
      // 여부와 무관하게 200으로 응답한다.
      const invite = await createInvite(pool, req.userId!);
      res.status(200).json(invite);
    } catch (err) {
      if (err instanceof InviteAcceptFailure) {
        res.status(409).json({ error: err.reason });
        return;
      }
      next(err);
    }
  });

  router.post('/:code/accept', async (req, res, next) => {
    try {
      const raw = req.body?.relationshipStartDate;
      let relationshipStartDate: string | null = null;
      if (raw !== undefined && raw !== null) {
        if (typeof raw !== 'string' || !isValidCalendarDate(raw)) {
          res.status(400).json({ error: 'invalid-relationship-start-date' });
          return;
        }
        relationshipStartDate = raw;
      }
      const result = await acceptInvite(pool, req.params.code!, req.userId!, relationshipStartDate);
      res.json(result);
    } catch (err) {
      if (err instanceof InviteAcceptFailure) {
        res.status(409).json({ error: err.reason });
        return;
      }
      next(err);
    }
  });

  router.post('/:code/revoke', async (req, res, next) => {
    try {
      await revokeInvite(pool, req.params.code!, req.userId!);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
