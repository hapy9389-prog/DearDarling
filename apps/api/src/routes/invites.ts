import { Router } from 'express';
import type { Pool } from 'pg';
import {
  createInvite,
  acceptInvite,
  revokeInvite,
  InviteAcceptFailure,
} from '../services/inviteService';
import { isValidCalendarDate } from '../domain/date';

export function createInvitesRouter(pool: Pool): Router {
  const router = Router();

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
